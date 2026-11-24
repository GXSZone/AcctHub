-- 保证订单第一次交付的时间在同一写入中记录。
CREATE TRIGGER orders_record_first_delivery_insert
AFTER INSERT ON orders
WHEN NEW.status = 'delivered' AND length(trim(NEW.delivered_payload)) > 0 AND NEW.delivered_at IS NULL
BEGIN
  UPDATE orders SET delivered_at = datetime('now') WHERE id = NEW.id;
END;--> statement-breakpoint
CREATE TRIGGER orders_record_first_delivery_update
AFTER UPDATE OF status, delivered_payload ON orders
WHEN NEW.status = 'delivered'
  AND OLD.status <> 'delivered'
  AND length(trim(NEW.delivered_payload)) > 0
  AND NEW.delivered_at IS NULL
BEGIN
  UPDATE orders SET delivered_at = datetime('now') WHERE id = NEW.id;
END;--> statement-breakpoint
-- 到货通知随实际可用库存写入。按站点、规格和订阅周期去重。
CREATE TRIGGER product_cards_restock_outbox
AFTER INSERT ON product_cards
WHEN NEW.status = 'available'
BEGIN
  INSERT INTO mail_outbox (owner_agent_id, event_key, scene, subscription_id, subscription_cycle, restock_title)
    SELECT site_agent_id, 'restock:' || id || ':' || cycle, 'restock_alert', id, cycle,
      coalesce((SELECT title FROM products WHERE id = NEW.product_id), '#' || NEW.product_id)
    FROM restock_subscriptions
    WHERE product_id = NEW.product_id AND spec_id = NEW.spec_id AND status = 'waiting'
    ON CONFLICT (owner_agent_id, event_key) DO NOTHING;
  UPDATE restock_subscriptions SET status = 'queued'
    WHERE product_id = NEW.product_id AND spec_id = NEW.spec_id AND status = 'waiting'
      AND EXISTS (SELECT 1 FROM mail_outbox
        WHERE owner_agent_id = restock_subscriptions.site_agent_id
          AND event_key = 'restock:' || restock_subscriptions.id || ':' || restock_subscriptions.cycle
          AND status = 'pending');
END;--> statement-breakpoint
-- 商城下单和交付的通知与对应的订单状态在同一次写入中入队。
CREATE TRIGGER orders_mail_outbox_insert
AFTER INSERT ON orders
WHEN NEW.channel = 'web' AND NEW.public_order_no IS NOT NULL AND NEW.contact_email <> ''
  AND NEW.status IN ('pending_payment', 'paid', 'upstream_pending', 'delivered')
BEGIN
  INSERT INTO mail_outbox (owner_agent_id, event_key, scene, order_id)
    SELECT COALESCE(NEW.agent_id, 0), 'order_created:' || NEW.public_order_no, 'order_created', NEW.id
    WHERE EXISTS (SELECT 1 FROM site_mail_configs WHERE owner_agent_id = COALESCE(NEW.agent_id, 0) AND enabled = 1 AND auto_send_order = 1)
    ON CONFLICT (owner_agent_id, event_key) DO NOTHING;
  INSERT INTO mail_outbox (owner_agent_id, event_key, scene, order_id)
    SELECT COALESCE(NEW.agent_id, 0), 'order_delivery:' || NEW.public_order_no, 'order_delivery', NEW.id
    WHERE NEW.status = 'delivered' AND trim(NEW.delivered_payload) <> ''
      AND EXISTS (SELECT 1 FROM site_mail_configs WHERE owner_agent_id = COALESCE(NEW.agent_id, 0) AND enabled = 1 AND auto_send_order = 1)
    ON CONFLICT (owner_agent_id, event_key) DO NOTHING;
END;--> statement-breakpoint
CREATE TRIGGER orders_mail_outbox_transition
AFTER UPDATE OF status, delivered_payload ON orders
WHEN NEW.channel = 'web' AND NEW.public_order_no IS NOT NULL AND NEW.contact_email <> ''
  AND NEW.status IN ('pending_payment', 'paid', 'upstream_pending', 'delivered')
BEGIN
  INSERT INTO mail_outbox (owner_agent_id, event_key, scene, order_id)
    SELECT COALESCE(NEW.agent_id, 0), 'order_created:' || NEW.public_order_no, 'order_created', NEW.id
    WHERE OLD.status = 'processing'
      AND EXISTS (SELECT 1 FROM site_mail_configs WHERE owner_agent_id = COALESCE(NEW.agent_id, 0) AND enabled = 1 AND auto_send_order = 1)
    ON CONFLICT (owner_agent_id, event_key) DO NOTHING;
  INSERT INTO mail_outbox (owner_agent_id, event_key, scene, order_id)
    SELECT COALESCE(NEW.agent_id, 0), 'order_delivery:' || NEW.public_order_no, 'order_delivery', NEW.id
    WHERE NEW.status = 'delivered' AND trim(NEW.delivered_payload) <> ''
      AND (OLD.status <> 'delivered' OR trim(OLD.delivered_payload) = '')
      AND EXISTS (SELECT 1 FROM site_mail_configs WHERE owner_agent_id = COALESCE(NEW.agent_id, 0) AND enabled = 1 AND auto_send_order = 1)
    ON CONFLICT (owner_agent_id, event_key) DO NOTHING;
END;
