CREATE TABLE `medication_favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`medication_name` text NOT NULL,
	`strength` text,
	`default_dose` text,
	`default_dose_unit` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `medication_favorites_name_idx` ON `medication_favorites` (`medication_name`);--> statement-breakpoint
CREATE TABLE `medication_records` (
	`id` text PRIMARY KEY NOT NULL,
	`medication_name` text NOT NULL,
	`strength` text,
	`dose` text NOT NULL,
	`dose_unit` text NOT NULL,
	`occurred_at` text NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `medication_records_occurred_at_idx` ON `medication_records` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `recurring_task_skips` (
	`id` text PRIMARY KEY NOT NULL,
	`recurring_task_id` text NOT NULL,
	`date_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recurring_task_skips_rule_date_idx` ON `recurring_task_skips` (`recurring_task_id`,`date_key`);