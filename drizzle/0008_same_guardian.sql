CREATE TABLE `baby_event_archive` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`action` text NOT NULL,
	`snapshot` text NOT NULL,
	`archived_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `baby_event_archive_event_idx` ON `baby_event_archive` (`event_id`,`archived_at`);