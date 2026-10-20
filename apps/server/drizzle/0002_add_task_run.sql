CREATE TABLE `task_run` (
	`id` text PRIMARY KEY NOT NULL,
	`task` text NOT NULL,
	`command_snapshot` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`exit_code` integer,
	`log_text` text
);
