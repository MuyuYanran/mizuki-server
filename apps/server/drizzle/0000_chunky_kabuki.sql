CREATE TABLE `admin_user` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_login_at` integer,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_user_username_unique` ON `admin_user` (`username`);--> statement-breakpoint
CREATE TABLE `article` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`source_type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`file_path` text,
	`file_hash` text,
	`category_id` text,
	`cover` text,
	`summary` text,
	`pinned` integer DEFAULT false NOT NULL,
	`pub_date` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_slug_unique` ON `article` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_article_status_date` ON `article` (`status`,`pub_date`);--> statement-breakpoint
CREATE INDEX `idx_article_source_type` ON `article` (`source_type`);--> statement-breakpoint
CREATE TABLE `article_content` (
	`article_id` text PRIMARY KEY NOT NULL,
	`doc_json` text NOT NULL,
	`html_cache` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `article`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `article_tag` (
	`article_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`article_id`, `tag_id`)
);
--> statement-breakpoint
CREATE TABLE `backup_record` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`manifest_path` text NOT NULL,
	`file_count` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `category` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_name_unique` ON `category` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `category_slug_unique` ON `category` (`slug`);--> statement-breakpoint
CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`parent_id` text,
	`author_name` text NOT NULL,
	`author_email` text,
	`author_url` text,
	`content` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`ip_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_file` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`original_name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_file_path_unique` ON `media_file` (`path`);--> statement-breakpoint
CREATE TABLE `operation_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`detail` text,
	`ip` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `tag_slug_unique` ON `tag` (`slug`);