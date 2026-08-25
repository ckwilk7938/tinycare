CREATE TABLE `scheduled_email_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`resend_email_id` text NOT NULL,
	`kind` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`recipient` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduled_email_reminders_event_idx` ON `scheduled_email_reminders` (`event_id`);--> statement-breakpoint
ALTER TABLE `tracker_profiles` ADD `email` text;--> statement-breakpoint
ALTER TABLE `tracker_profiles` ADD `email_reminders_enabled` integer DEFAULT false NOT NULL;