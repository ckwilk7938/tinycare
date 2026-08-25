CREATE TABLE `planner_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`duration_minutes` integer DEFAULT 30 NOT NULL,
	`note` text,
	`created_by` text,
	`completed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `planner_tasks_scheduled_at_idx` ON `planner_tasks` (`scheduled_at`);