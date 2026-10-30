CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`action` text,
	`scene` text NOT NULL,
	`profile_id` text,
	`model` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`duration_ms` integer NOT NULL,
	`status` text NOT NULL,
	`error_code` text
);
--> statement-breakpoint
CREATE INDEX `ai_usage_created_at_idx` ON `ai_usage` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_action_idx` ON `ai_usage` (`action`);