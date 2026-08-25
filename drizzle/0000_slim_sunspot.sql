CREATE TABLE `baby_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`ended_at` text,
	`detail` text NOT NULL,
	`amount_ml` integer,
	`note` text,
	`created_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `baby_events_type_idx` ON `baby_events` (`type`);--> statement-breakpoint
CREATE INDEX `baby_events_occurred_at_idx` ON `baby_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `baby_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
