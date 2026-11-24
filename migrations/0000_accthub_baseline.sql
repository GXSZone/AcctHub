CREATE TABLE `agent_product_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`is_listed` integer DEFAULT 1 NOT NULL,
	`custom_title` text,
	`custom_subtitle` text,
	`custom_detail_markdown` text,
	`custom_risk_notice` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_agent_prod_override` ON `agent_product_overrides` (`agent_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `agent_product_prices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`spec_id` text DEFAULT 'default' NOT NULL,
	`custom_price` real NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_agent_prod_price` ON `agent_product_prices` (`agent_id`,`product_id`,`spec_id`);--> statement-breakpoint
CREATE TABLE `agent_tiers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_agent_id` integer DEFAULT 0 NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`level_rank` integer DEFAULT 1 NOT NULL,
	`min_recharge` real DEFAULT 100 NOT NULL,
	`discount_rate` real DEFAULT 0.9 NOT NULL,
	`commission_rate` real DEFAULT 0 NOT NULL,
	`sub_override_rate` real DEFAULT 0 NOT NULL,
	`max_sub_agents` integer DEFAULT 5 NOT NULL,
	`allow_custom_domain` integer DEFAULT 1 NOT NULL,
	`max_custom_domains` integer DEFAULT 2 NOT NULL,
	`allow_private_products` integer DEFAULT 0 NOT NULL,
	`allow_own_payment` integer DEFAULT 0 NOT NULL,
	`badge_color` text DEFAULT '#9A6E4B' NOT NULL,
	`perks_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_agent_tiers_owner_code` ON `agent_tiers` (`owner_agent_id`,`code`);--> statement-breakpoint
CREATE TABLE `agent_withdrawals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`amount` real NOT NULL,
	`channel` text DEFAULT 'alipay' NOT NULL,
	`account_info` text NOT NULL,
	`account_name` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`admin_note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`processed_at` text,
	`fee_rate` real DEFAULT 0 NOT NULL,
	`fee_amount` real DEFAULT 0 NOT NULL,
	`net_amount` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_withdrawals_agent_status` ON `agent_withdrawals` (`agent_id`,`status`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`tier_id` integer,
	`parent_agent_id` integer,
	`depth` integer DEFAULT 1 NOT NULL,
	`ancestor_path` text DEFAULT '/' NOT NULL,
	`can_recruit` integer DEFAULT 1 NOT NULL,
	`slug` text NOT NULL,
	`brand_name` text NOT NULL,
	`brand_tagline` text DEFAULT '' NOT NULL,
	`theme_accent` text DEFAULT '' NOT NULL,
	`favicon_url` text DEFAULT '' NOT NULL,
	`og_image_url` text DEFAULT '' NOT NULL,
	`seo_title` text DEFAULT '' NOT NULL,
	`seo_description` text DEFAULT '' NOT NULL,
	`footer_text` text DEFAULT '' NOT NULL,
	`support_label` text DEFAULT '' NOT NULL,
	`support_url` text DEFAULT '' NOT NULL,
	`support_note` text DEFAULT '' NOT NULL,
	`support_media_json` text DEFAULT '[]' NOT NULL,
	`support_links_json` text DEFAULT '[]' NOT NULL,
	`announcement_banner` text DEFAULT '' NOT NULL,
	`ticker_enabled` integer DEFAULT 1 NOT NULL,
	`ticker_mode` text DEFAULT 'vertical' NOT NULL,
	`ticker_include_notices` integer DEFAULT 1 NOT NULL,
	`popup_enabled` integer DEFAULT 0 NOT NULL,
	`popup_title` text DEFAULT '' NOT NULL,
	`popup_content` text DEFAULT '' NOT NULL,
	`popup_frequency` text DEFAULT 'once_per_day' NOT NULL,
	`popup_version` text DEFAULT '1' NOT NULL,
	`downline_popup_enabled` integer DEFAULT 0 NOT NULL,
	`downline_popup_title` text DEFAULT '' NOT NULL,
	`downline_popup_content` text DEFAULT '' NOT NULL,
	`downline_popup_frequency` text DEFAULT 'once_per_day' NOT NULL,
	`downline_popup_version` text DEFAULT '1' NOT NULL,
	`api_ip_whitelist` text DEFAULT '' NOT NULL,
	`markup_percent` real DEFAULT 12 NOT NULL,
	`commission_rate` real DEFAULT 0 NOT NULL,
	`api_key` text NOT NULL,
	`api_key_hash` text DEFAULT '' NOT NULL,
	`api_key_enc` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`allow_private_products_override` integer,
	`allow_own_payment_override` integer,
	`total_revenue` real DEFAULT 0 NOT NULL,
	`total_commission` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_user_id_unique` ON `agents` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_slug_unique` ON `agents` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_api_key_unique` ON `agents` (`api_key`);--> statement-breakpoint
CREATE INDEX `idx_agents_parent` ON `agents` (`parent_agent_id`);--> statement-breakpoint
CREATE INDEX `idx_agents_api_key_hash` ON `agents` (`api_key_hash`);--> statement-breakpoint
CREATE TABLE `commission_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_no` text NOT NULL,
	`beneficiary_agent_id` integer NOT NULL,
	`source_agent_id` integer NOT NULL,
	`hop_distance` integer DEFAULT 0 NOT NULL,
	`reward_type` text DEFAULT 'direct_sale' NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_commission_beneficiary` ON `commission_ledger` (`beneficiary_agent_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_commission_order` ON `commission_ledger` (`order_no`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_agent_id` integer DEFAULT 0 NOT NULL,
	`group_id` integer NOT NULL,
	`parent_id` integer,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`name_en` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT 'sparkles' NOT NULL,
	`badge_text` text DEFAULT '' NOT NULL,
	`schema_type` text DEFAULT 'ai_subscription' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_categories_owner_slug` ON `categories` (`owner_agent_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_categories_group_sort` ON `categories` (`group_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `category_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`name_en` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_collapsible` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_groups_slug_unique` ON `category_groups` (`slug`);--> statement-breakpoint
CREATE TABLE `product_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_agent_id` integer DEFAULT 0 NOT NULL,
	`product_id` integer NOT NULL,
	`spec_id` text DEFAULT 'default' NOT NULL,
	`card_content` text NOT NULL,
	`credential_fingerprint` text,
	`upstream_purchase_id` integer,
	`status` text DEFAULT 'available' NOT NULL,
	`order_no` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`sold_at` text,
	`is_loop` integer DEFAULT 0 NOT NULL,
	`public_label` text DEFAULT '' NOT NULL,
	`select_fee` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cards_prod_spec_status` ON `product_cards` (`product_id`,`spec_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_cards_selectable` ON `product_cards` (`product_id`,`spec_id`,`status`,`public_label`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_product_cards_fingerprint` ON `product_cards` (`product_id`,`credential_fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_product_cards_upstream_purchase` ON `product_cards` (`upstream_purchase_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_agent_id` integer DEFAULT 0 NOT NULL,
	`product_source` text DEFAULT 'platform' NOT NULL,
	`category_id` integer NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`title_en` text DEFAULT '' NOT NULL,
	`subtitle` text DEFAULT '' NOT NULL,
	`subtitle_en` text DEFAULT '' NOT NULL,
	`icon_key` text DEFAULT 'sparkles' NOT NULL,
	`accent_color` text DEFAULT '#D97757' NOT NULL,
	`delivery_type` text DEFAULT 'auto' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`base_price` real DEFAULT 0 NOT NULL,
	`original_price` real,
	`cost_price` real,
	`wholesale_discount` real DEFAULT 0.82 NOT NULL,
	`stock_mode` text DEFAULT 'cards' NOT NULL,
	`manual_stock` integer DEFAULT 99 NOT NULL,
	`seat_total` integer DEFAULT 0 NOT NULL,
	`seat_used` integer DEFAULT 0 NOT NULL,
	`summary_markdown` text DEFAULT '' NOT NULL,
	`detail_markdown` text DEFAULT '' NOT NULL,
	`risk_notice` text DEFAULT '' NOT NULL,
	`warranty_type` text DEFAULT 'full_period' NOT NULL,
	`warranty_days` integer DEFAULT 30 NOT NULL,
	`warranty_summary` text DEFAULT '' NOT NULL,
	`translations_json` text DEFAULT '{}' NOT NULL,
	`faq_json` text DEFAULT '[]' NOT NULL,
	`custom_fields_json` text DEFAULT '[]' NOT NULL,
	`specs_json` text DEFAULT '[]' NOT NULL,
	`tier_pricing_json` text DEFAULT '[]' NOT NULL,
	`upstream_source_id` integer,
	`upstream_item_id` text,
	`upstream_cost` real,
	`is_featured` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`sales_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`min_quantity` integer DEFAULT 1 NOT NULL,
	`max_quantity` integer DEFAULT 0 NOT NULL,
	`require_login` integer DEFAULT 0 NOT NULL,
	`is_hidden` integer DEFAULT 0 NOT NULL,
	`access_password` text DEFAULT '' NOT NULL,
	`flash_sale_price` real,
	`flash_sale_start_at` text DEFAULT '' NOT NULL,
	`flash_sale_end_at` text DEFAULT '' NOT NULL,
	`flash_sale_limit` integer DEFAULT 0 NOT NULL,
	`flash_sale_sold` integer DEFAULT 0 NOT NULL,
	`bundle_items_json` text DEFAULT '[]' NOT NULL,
	`group_buy_enabled` integer DEFAULT 0 NOT NULL,
	`group_buy_size` integer DEFAULT 2 NOT NULL,
	`group_buy_price` real,
	`group_buy_hours` integer DEFAULT 24 NOT NULL,
	`allow_card_selection` integer DEFAULT 0 NOT NULL,
	`card_select_fee` real DEFAULT 0 NOT NULL,
	`member_price` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_products_owner_slug` ON `products` (`owner_agent_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_products_owner_active` ON `products` (`owner_agent_id`,`is_active`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_products_cat_active` ON `products` (`category_id`,`is_active`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_products_featured` ON `products` (`is_featured`,`is_active`);--> statement-breakpoint
CREATE TABLE `restock_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_agent_id` integer DEFAULT 0 NOT NULL,
	`product_id` integer NOT NULL,
	`spec_id` text DEFAULT 'default' NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`notified_at` text,
	`cycle` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_restock_sub` ON `restock_subscriptions` (`site_agent_id`,`product_id`,`spec_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_restock_ready` ON `restock_subscriptions` (`product_id`,`spec_id`,`status`);--> statement-breakpoint
CREATE TABLE `group_buy_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`order_no` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`paid_amount` real DEFAULT 0 NOT NULL,
	`promo_used_amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'paid' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_group_buy_members_order` ON `group_buy_members` (`order_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_group_buy_members_session_user` ON `group_buy_members` (`session_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_group_buy_members_session_status` ON `group_buy_members` (`session_id`,`status`);--> statement-breakpoint
CREATE TABLE `group_buy_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`site_agent_id` integer DEFAULT 0 NOT NULL,
	`product_id` integer NOT NULL,
	`spec_id` text DEFAULT 'default' NOT NULL,
	`leader_user_id` integer NOT NULL,
	`leader_name` text DEFAULT '' NOT NULL,
	`required_size` integer DEFAULT 2 NOT NULL,
	`current_size` integer DEFAULT 0 NOT NULL,
	`group_price` real NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`expires_at` text NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_group_buy_sessions_code` ON `group_buy_sessions` (`code`);--> statement-breakpoint
CREATE INDEX `idx_group_buy_sessions_prod_status` ON `group_buy_sessions` (`site_agent_id`,`product_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_group_buy_sessions_expiry` ON `group_buy_sessions` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `admin_audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` integer DEFAULT 0 NOT NULL,
	`actor_email` text DEFAULT 'system' NOT NULL,
	`actor_role` text DEFAULT 'admin' NOT NULL,
	`action` text NOT NULL,
	`target_type` text DEFAULT 'system' NOT NULL,
	`target_id` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`before_json` text DEFAULT '{}' NOT NULL,
	`after_json` text DEFAULT '{}' NOT NULL,
	`ip` text DEFAULT '' NOT NULL,
	`user_agent` text DEFAULT '' NOT NULL,
	`request_id` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_admin_audit_action` ON `admin_audit_logs` (`action`,`id`);--> statement-breakpoint
CREATE INDEX `idx_admin_audit_actor` ON `admin_audit_logs` (`actor_user_id`,`id`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_agent_id` integer DEFAULT 0 NOT NULL,
	`audience` text DEFAULT 'storefront' NOT NULL,
	`title` text NOT NULL,
	`title_en` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`content_en` text DEFAULT '' NOT NULL,
	`translations_json` text DEFAULT '{}' NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`is_pinned` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_announcements_owner_aud` ON `announcements` (`owner_agent_id`,`audience`,`is_active`);--> statement-breakpoint
CREATE TABLE `email_delivery_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_agent_id` integer DEFAULT 0 NOT NULL,
	`order_no` text DEFAULT '' NOT NULL,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`scene` text DEFAULT 'order_delivery' NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_email_logs_owner` ON `email_delivery_logs` (`owner_agent_id`,`id`);--> statement-breakpoint
CREATE TABLE `help_articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_agent_id` integer DEFAULT 0 NOT NULL,
	`category` text DEFAULT '入门指南' NOT NULL,
	`title` text NOT NULL,
	`title_en` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`content_en` text DEFAULT '' NOT NULL,
	`translations_json` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_help_articles_owner` ON `help_articles` (`owner_agent_id`,`is_active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `mail_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_agent_id` integer NOT NULL,
	`event_key` text NOT NULL,
	`scene` text NOT NULL,
	`payload` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`lease_token` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`order_id` integer,
	`subscription_id` integer,
	`subscription_cycle` integer,
	`restock_title` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mail_outbox_event` ON `mail_outbox` (`owner_agent_id`,`event_key`);--> statement-breakpoint
CREATE INDEX `idx_mail_outbox_due` ON `mail_outbox` (`status`,`next_attempt_at`,`lease_until`);--> statement-breakpoint
CREATE INDEX `idx_mail_outbox_order` ON `mail_outbox` (`order_id`,`scene`);--> statement-breakpoint
CREATE TABLE `payment_plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_mail_configs` (
	`owner_agent_id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`auto_send_order` integer DEFAULT 1 NOT NULL,
	`auto_send_restock` integer DEFAULT 1 NOT NULL,
	`provider` text DEFAULT 'resend' NOT NULL,
	`from_name` text DEFAULT '' NOT NULL,
	`from_email` text DEFAULT '' NOT NULL,
	`reply_to` text DEFAULT '' NOT NULL,
	`api_key_encrypted` text DEFAULT '' NOT NULL,
	`api_endpoint` text DEFAULT '' NOT NULL,
	`mailgun_domain` text DEFAULT '' NOT NULL,
	`footer_note` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`order_email_subject_tpl` text DEFAULT '' NOT NULL,
	`order_email_body_tpl` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_login_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`ip` text DEFAULT '' NOT NULL,
	`user_agent` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_login_logs_user` ON `user_login_logs` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`session_version` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_sessions_user_expiry` ON `user_sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_agent_id` integer DEFAULT 0 NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`session_version` integer DEFAULT 0 NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`balance` real DEFAULT 0 NOT NULL,
	`total_recharged` real DEFAULT 0 NOT NULL,
	`referral_code` text,
	`referred_by_user_id` integer,
	`promo_balance` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`status_note` text DEFAULT '' NOT NULL,
	`totp_secret_enc` text DEFAULT '' NOT NULL,
	`totp_enabled` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_site_email` ON `users` (`site_agent_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_referral_code` ON `users` (`referral_code`) WHERE "users"."referral_code" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `affiliate_ledgers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`referrer_user_id` integer NOT NULL,
	`buyer_user_id` integer NOT NULL,
	`order_no` text NOT NULL,
	`order_amount` real NOT NULL,
	`commission_rate` real NOT NULL,
	`reward_amount` real NOT NULL,
	`clawed_back_amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'settled' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `affiliate_ledgers_order_no_unique` ON `affiliate_ledgers` (`order_no`);--> statement-breakpoint
CREATE INDEX `idx_affiliate_referrer` ON `affiliate_ledgers` (`referrer_user_id`,`id`);--> statement-breakpoint
CREATE TABLE `promo_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`balance_after` real DEFAULT 0 NOT NULL,
	`ref_no` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_promo_tx_user` ON `promo_transactions` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_promo_tx_ref` ON `promo_transactions` (`ref_no`);--> statement-breakpoint
CREATE TABLE `oauth_auth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`site_agent_id` integer DEFAULT 0 NOT NULL,
	`return_origin` text NOT NULL,
	`redirect_path` text DEFAULT '/' NOT NULL,
	`mode` text DEFAULT 'login' NOT NULL,
	`bind_user_id` integer,
	`code_verifier` text DEFAULT '' NOT NULL,
	`referral_code` text DEFAULT '' NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_states_expires` ON `oauth_auth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_exchange_tickets` (
	`ticket_hash` text PRIMARY KEY NOT NULL,
	`site_agent_id` integer DEFAULT 0 NOT NULL,
	`user_id` integer NOT NULL,
	`redirect_path` text DEFAULT '/' NOT NULL,
	`action` text DEFAULT 'login' NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_tickets_expires` ON `oauth_exchange_tickets` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_oauth_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_agent_id` integer DEFAULT 0 NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`union_id` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`nickname` text DEFAULT '' NOT NULL,
	`avatar_url` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_oauth_site_provider_uid` ON `user_oauth_identities` (`site_agent_id`,`provider`,`provider_user_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_user_id` ON `user_oauth_identities` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_union_id` ON `user_oauth_identities` (`site_agent_id`,`union_id`);--> statement-breakpoint
CREATE TABLE `coupons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_agent_id` integer DEFAULT 0 NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`discount_type` text DEFAULT 'fixed' NOT NULL,
	`discount_value` real DEFAULT 5 NOT NULL,
	`min_order_amount` real DEFAULT 0 NOT NULL,
	`max_uses` integer DEFAULT 100 NOT NULL,
	`used_count` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_coupons_owner_code` ON `coupons` (`owner_agent_id`,`code`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_no` text NOT NULL,
	`user_id` integer,
	`agent_id` integer,
	`tenant_slug` text,
	`contact_email` text NOT NULL,
	`public_order_no` text,
	`lookup_url` text,
	`query_password_hash` text,
	`checkout_secret_hash` text,
	`checkout_payload_hash` text,
	`product_id` integer NOT NULL,
	`product_owner_agent_id` integer DEFAULT 0 NOT NULL,
	`settlement_mode` text DEFAULT 'platform_collect' NOT NULL,
	`product_title` text NOT NULL,
	`spec_id` text DEFAULT 'default' NOT NULL,
	`spec_name` text DEFAULT '' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price` real NOT NULL,
	`total_amount` real NOT NULL,
	`discount_amount` real DEFAULT 0 NOT NULL,
	`coupon_code` text,
	`coupon_discount` real DEFAULT 0 NOT NULL,
	`promo_used_amount` real DEFAULT 0 NOT NULL,
	`commission_amount` real DEFAULT 0 NOT NULL,
	`payment_method` text DEFAULT 'balance' NOT NULL,
	`channel` text DEFAULT 'web' NOT NULL,
	`status` text DEFAULT 'paid' NOT NULL,
	`custom_inputs_json` text DEFAULT '{}' NOT NULL,
	`delivered_payload` text DEFAULT '' NOT NULL,
	`idempotency_key` text,
	`reseller_request_digest` text,
	`fulfillment_source` text DEFAULT 'local' NOT NULL,
	`upstream_source_id` integer,
	`upstream_order_no` text DEFAULT '' NOT NULL,
	`upstream_cost_total` real DEFAULT 0 NOT NULL,
	`upstream_status` text DEFAULT 'none' NOT NULL,
	`upstream_error` text DEFAULT '' NOT NULL,
	`warranty_type` text DEFAULT 'full_period' NOT NULL,
	`delivered_at` text,
	`warranty_days` integer DEFAULT 30 NOT NULL,
	`warranty_summary` text DEFAULT '' NOT NULL,
	`payment_intent_no` text,
	`payment_expires_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`buyer_ip` text DEFAULT '' NOT NULL,
	`payment_fee_amount` real DEFAULT 0 NOT NULL,
	`risk_flag` text DEFAULT '' NOT NULL,
	`risk_note` text DEFAULT '' NOT NULL,
	`group_buy_session_id` integer,
	`renewal_reminded_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_no_unique` ON `orders` (`order_no`);--> statement-breakpoint
CREATE INDEX `idx_orders_agent_created` ON `orders` (`agent_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_orders_email` ON `orders` (`contact_email`);--> statement-breakpoint
CREATE INDEX `idx_orders_status` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_user_site_page` ON `orders` (`user_id`,`agent_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_orders_buyer_ip` ON `orders` (`buyer_ip`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_group_buy_session` ON `orders` (`group_buy_session_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_renewal_scan` ON `orders` (`status`,`renewal_reminded_at`,`delivered_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_orders_public_order_no` ON `orders` (`public_order_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_orders_main_checkout_key` ON `orders` (`idempotency_key`) WHERE "orders"."agent_id" IS NULL AND "orders"."checkout_payload_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_orders_subsite_checkout_key` ON `orders` (`agent_id`,`idempotency_key`) WHERE "orders"."agent_id" IS NOT NULL AND "orders"."checkout_payload_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_orders_reseller_idempotency` ON `orders` (`agent_id`,`idempotency_key`) WHERE "orders"."channel" = 'reseller_api' AND "orders"."idempotency_key" IS NOT NULL AND "orders"."idempotency_key" <> '';--> statement-breakpoint
CREATE TABLE `payment_intents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`intent_no` text NOT NULL,
	`biz_type` text DEFAULT 'order' NOT NULL,
	`biz_ref` text NOT NULL,
	`user_id` integer,
	`site_agent_id` integer DEFAULT 0 NOT NULL,
	`payment_owner_agent_id` integer DEFAULT 0 NOT NULL,
	`settlement_mode` text DEFAULT 'platform_collect' NOT NULL,
	`provider` text NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`amount_cny` real NOT NULL,
	`pay_amount` real NOT NULL,
	`pay_url` text DEFAULT '' NOT NULL,
	`qr_content` text DEFAULT '' NOT NULL,
	`provider_trade_no` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`fulfill_status` text DEFAULT 'pending' NOT NULL,
	`fulfill_error` text DEFAULT '' NOT NULL,
	`fulfill_lease_token` text,
	`fulfill_lease_until` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`expires_at` text NOT NULL,
	`paid_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_intents_intent_no_unique` ON `payment_intents` (`intent_no`);--> statement-breakpoint
CREATE INDEX `idx_payment_intents_biz` ON `payment_intents` (`biz_type`,`biz_ref`);--> statement-breakpoint
CREATE INDEX `idx_payment_intents_provider_status_amt` ON `payment_intents` (`provider`,`status`,`pay_amount`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payment_intents_provider_trade` ON `payment_intents` (`provider`,`provider_trade_no`) WHERE "payment_intents"."status" = 'paid' AND "payment_intents"."provider_trade_no" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX `uq_usdt_active_pay_amount` ON `payment_intents` (`provider`,`pay_amount`) WHERE "payment_intents"."provider" IN ('usdt_trc20', 'usdt_bep20', 'usdt_erc20') AND "payment_intents"."status" = 'pending';--> statement-breakpoint
CREATE TABLE `recharge_cdks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`amount` real NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`used_by_user_id` integer,
	`used_by_email` text,
	`used_at` text,
	`batch_note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recharge_cdks_code_unique` ON `recharge_cdks` (`code`);--> statement-breakpoint
CREATE INDEX `idx_cdks_status` ON `recharge_cdks` (`status`);--> statement-breakpoint
CREATE TABLE `recharge_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`amount` real NOT NULL,
	`payment_method` text DEFAULT 'balance' NOT NULL,
	`unlocked_tier_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_recharge_user` ON `recharge_records` (`user_id`);--> statement-breakpoint
CREATE TABLE `wallet_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`balance_after` real DEFAULT 0 NOT NULL,
	`ref_no` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_wallet_tx_user` ON `wallet_transactions` (`user_id`,`id`);--> statement-breakpoint
CREATE TABLE `order_refunds` (
	`order_no` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`site_agent_id` integer NOT NULL,
	`mode` text NOT NULL,
	`route` text NOT NULL,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`payment_intent_no` text,
	`original_payment` text NOT NULL,
	`currency` text NOT NULL,
	`amount` real NOT NULL,
	`amount_cny` real NOT NULL,
	`provider_refund_id` text,
	`proof_reference` text,
	`completion_token` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_refunds_operation_id_unique` ON `order_refunds` (`operation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_order_refund_proof` ON `order_refunds` (`provider`,`proof_reference`) WHERE "order_refunds"."proof_reference" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_order_refund_provider_id` ON `order_refunds` (`provider`,`provider_refund_id`) WHERE "order_refunds"."provider_refund_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_order_refund_original` ON `order_refunds` (`provider`,`original_payment`) WHERE "order_refunds"."route" IN ('original_payment', 'wallet_compensation');--> statement-breakpoint
CREATE TABLE `refund_commission_recoveries` (
	`order_no` text NOT NULL,
	`beneficiary_agent_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`assessed_amount` real NOT NULL,
	`recovered_amount` real NOT NULL,
	`receivable_amount` real NOT NULL,
	PRIMARY KEY(`order_no`, `beneficiary_agent_id`)
);
--> statement-breakpoint
CREATE TABLE `refund_policies` (
	`site_agent_id` integer PRIMARY KEY NOT NULL,
	`mode` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ip_blacklist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ip_pattern` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ip_blacklist_pattern` ON `ip_blacklist` (`ip_pattern`);--> statement-breakpoint
CREATE TABLE `password_reset_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_agent_id` integer DEFAULT 0 NOT NULL,
	`user_id` integer NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pwd_reset_email_site` ON `password_reset_codes` (`site_agent_id`,`email`,`id`);--> statement-breakpoint
CREATE TABLE `risk_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_type` text NOT NULL,
	`severity` text DEFAULT 'critical' NOT NULL,
	`order_no` text DEFAULT '' NOT NULL,
	`buyer_ip` text DEFAULT '' NOT NULL,
	`contact_email` text DEFAULT '' NOT NULL,
	`summary` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`mail_alert_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_risk_events_type_time` ON `risk_events` (`event_type`,`created_at`);--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_no` text NOT NULL,
	`site_agent_id` integer DEFAULT 0 NOT NULL,
	`user_id` integer,
	`contact_email` text NOT NULL,
	`order_no` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'after_sale' NOT NULL,
	`subject` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`escalated_to_admin` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_tickets_ticket_no_unique` ON `support_tickets` (`ticket_no`);--> statement-breakpoint
CREATE INDEX `idx_tickets_site_status` ON `support_tickets` (`site_agent_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tickets_order` ON `support_tickets` (`order_no`);--> statement-breakpoint
CREATE TABLE `ticket_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`sender_role` text DEFAULT 'user' NOT NULL,
	`sender_name` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ticket_msgs_ticket` ON `ticket_messages` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `user_totp_vault` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`issuer` text DEFAULT '' NOT NULL,
	`account_name` text DEFAULT '' NOT NULL,
	`encrypted_secret` text NOT NULL,
	`digits` integer DEFAULT 6 NOT NULL,
	`period` integer DEFAULT 30 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_totp_user` ON `user_totp_vault` (`user_id`);--> statement-breakpoint
CREATE TABLE `tenant_domains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer NOT NULL,
	`hostname` text NOT NULL,
	`domain_type` text DEFAULT 'custom' NOT NULL,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`auth_mode` text DEFAULT 'manual_approval' NOT NULL,
	`status` text DEFAULT 'pending_dns' NOT NULL,
	`verification_token` text DEFAULT '' NOT NULL,
	`cf_hostname_id` text DEFAULT '' NOT NULL,
	`ssl_status` text DEFAULT 'pending' NOT NULL,
	`authorized_by_admin_id` integer,
	`authorized_at` text,
	`expires_at` text,
	`error_message` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_domains_hostname` ON `tenant_domains` (`hostname`);--> statement-breakpoint
CREATE INDEX `idx_tenant_domains_agent_status` ON `tenant_domains` (`agent_id`,`status`);--> statement-breakpoint
CREATE TABLE `tenant_payment_plugins` (
	`owner_agent_id` integer NOT NULL,
	`plugin_id` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`owner_agent_id`, `plugin_id`)
);
--> statement-breakpoint
CREATE TABLE `tenant_settings` (
	`owner_agent_id` integer DEFAULT 0 NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`owner_agent_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `tenant_sso_tickets` (
	`ticket_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`target_agent_id` integer NOT NULL,
	`redirect_path` text DEFAULT '/agent' NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tenant_sso_expiry` ON `tenant_sso_tickets` (`expires_at`);--> statement-breakpoint
CREATE TABLE `product_upstream_bindings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`spec_id` text DEFAULT 'default' NOT NULL,
	`source_id` integer NOT NULL,
	`upstream_item_id` text NOT NULL,
	`upstream_spec_id` text DEFAULT '' NOT NULL,
	`fulfillment_mode` text DEFAULT 'local_first' NOT NULL,
	`routing_strategy` text DEFAULT 'priority' NOT NULL,
	`priority` integer DEFAULT 10 NOT NULL,
	`cached_cost` real DEFAULT 0 NOT NULL,
	`cached_stock` integer DEFAULT 0 NOT NULL,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`circuit_broken_reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_prod_upstream_binding` ON `product_upstream_bindings` (`product_id`,`spec_id`,`source_id`,`upstream_item_id`,`upstream_spec_id`);--> statement-breakpoint
CREATE INDEX `idx_bindings_prod_spec_enabled` ON `product_upstream_bindings` (`product_id`,`spec_id`,`is_enabled`);--> statement-breakpoint
CREATE TABLE `upstream_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`upstream_item_id` text NOT NULL,
	`raw_title` text NOT NULL,
	`raw_category` text DEFAULT '' NOT NULL,
	`raw_price` real DEFAULT 0 NOT NULL,
	`raw_stock` integer DEFAULT 0 NOT NULL,
	`raw_status` text DEFAULT 'active' NOT NULL,
	`raw_specs_json` text DEFAULT '[]' NOT NULL,
	`raw_description` text DEFAULT '' NOT NULL,
	`raw_payload_json` text DEFAULT '{}' NOT NULL,
	`collect_status` text DEFAULT 'pending' NOT NULL,
	`local_product_id` integer,
	`target_category_id` integer,
	`lock_local_price` integer DEFAULT 0 NOT NULL,
	`lock_local_content` integer DEFAULT 1 NOT NULL,
	`last_seen_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_upstream_item` ON `upstream_items` (`source_id`,`upstream_item_id`);--> statement-breakpoint
CREATE INDEX `idx_upstream_items_local_prod` ON `upstream_items` (`local_product_id`);--> statement-breakpoint
CREATE TABLE `upstream_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`local_order_no` text DEFAULT '' NOT NULL,
	`attempt_no` integer DEFAULT 1 NOT NULL,
	`idempotency_out_trade_no` text NOT NULL,
	`source_id` integer NOT NULL,
	`source_name` text DEFAULT '' NOT NULL,
	`binding_id` integer,
	`product_id` integer,
	`spec_id` text DEFAULT 'default' NOT NULL,
	`upstream_item_id` text DEFAULT '' NOT NULL,
	`upstream_spec_id` text DEFAULT '' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`upstream_order_no` text DEFAULT '' NOT NULL,
	`upstream_cost` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`purpose` text DEFAULT 'order_fulfill' NOT NULL,
	`replacement_ticket_id` integer,
	`replacement_order_no` text,
	`replacement_note` text,
	`replacement_mail_status` text,
	`replacement_settlement_token` text,
	`cards_json` text DEFAULT '[]' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`raw_response_json` text DEFAULT '{}' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upstream_orders_idempotency_out_trade_no_unique` ON `upstream_orders` (`idempotency_out_trade_no`);--> statement-breakpoint
CREATE INDEX `idx_up_orders_local` ON `upstream_orders` (`local_order_no`);--> statement-breakpoint
CREATE INDEX `idx_up_orders_status` ON `upstream_orders` (`status`);--> statement-breakpoint
CREATE INDEX `idx_up_orders_poll` ON `upstream_orders` (`status`,`updated_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_upstream_replacement_ticket` ON `upstream_orders` (`replacement_ticket_id`) WHERE "upstream_orders"."replacement_ticket_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `upstream_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`creation_intent_key` text,
	`creation_request_digest` text,
	`adapter_type` text DEFAULT 'generic_json' NOT NULL,
	`auth_mode` text DEFAULT 'header_bearer' NOT NULL,
	`app_id` text DEFAULT '' NOT NULL,
	`base_url` text DEFAULT '' NOT NULL,
	`order_url` text DEFAULT '' NOT NULL,
	`query_order_url` text DEFAULT '' NOT NULL,
	`balance_url` text DEFAULT '' NOT NULL,
	`api_key_enc` text DEFAULT '' NOT NULL,
	`api_secret_enc` text DEFAULT '' NOT NULL,
	`webhook_secret_enc` text DEFAULT '' NOT NULL,
	`proxy_relay_url` text DEFAULT '' NOT NULL,
	`proxy_relay_token_enc` text DEFAULT '' NOT NULL,
	`auth_header` text DEFAULT 'Authorization' NOT NULL,
	`auth_prefix` text DEFAULT 'Bearer ' NOT NULL,
	`field_mapping_json` text DEFAULT '{}' NOT NULL,
	`filter_rules_json` text DEFAULT '{}' NOT NULL,
	`pricing_rules_json` text DEFAULT '{}' NOT NULL,
	`order_template_json` text DEFAULT '{}' NOT NULL,
	`response_mapping_json` text DEFAULT '{}' NOT NULL,
	`out_of_stock_action` text DEFAULT 'mark_sold_out' NOT NULL,
	`auto_republish_on_restock` integer DEFAULT 1 NOT NULL,
	`default_category_id` integer DEFAULT 1 NOT NULL,
	`sync_interval_minutes` integer DEFAULT 15 NOT NULL,
	`auto_sync_enabled` integer DEFAULT 1 NOT NULL,
	`cached_balance` real,
	`low_balance_threshold` real DEFAULT 100 NOT NULL,
	`balance_updated_at` text,
	`sandbox_mode` text DEFAULT 'normal' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_sync_at` text,
	`last_sync_status` text DEFAULT '' NOT NULL,
	`last_sync_message` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upstream_sources_creation_intent_key_unique` ON `upstream_sources` (`creation_intent_key`);--> statement-breakpoint
CREATE TABLE `upstream_sync_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`source_name` text DEFAULT '' NOT NULL,
	`trigger_type` text DEFAULT 'manual' NOT NULL,
	`status` text DEFAULT 'success' NOT NULL,
	`fetched_count` integer DEFAULT 0 NOT NULL,
	`synced_count` integer DEFAULT 0 NOT NULL,
	`out_of_stock_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`alerts_json` text DEFAULT '[]' NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sync_logs_source` ON `upstream_sync_logs` (`source_id`,`id`);--> statement-breakpoint
CREATE TABLE `wallet_events` (
	`event_key` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbound_webhooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_agent_id` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`secret_enc` text DEFAULT '' NOT NULL,
	`events_json` text DEFAULT '["order.delivered","order.refunded"]' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`allow_fulfill_override` integer DEFAULT 0 NOT NULL,
	`last_status` integer,
	`last_error` text DEFAULT '' NOT NULL,
	`last_triggered_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_outbound_webhooks_owner_enabled` ON `outbound_webhooks` (`owner_agent_id`,`enabled`);--> statement-breakpoint
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
