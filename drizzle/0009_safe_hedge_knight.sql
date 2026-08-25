CREATE TABLE `recurring_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`time_of_day` text NOT NULL,
	`weekdays` text NOT NULL,
	`duration_minutes` integer DEFAULT 30 NOT NULL,
	`note` text,
	`created_by` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recurring_tasks_active_idx` ON `recurring_tasks` (`active`);