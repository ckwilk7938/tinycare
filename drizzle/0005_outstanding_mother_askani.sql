CREATE TABLE `tracker_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`next_feed_minutes` integer NOT NULL,
	`formula_reminder_enabled` integer DEFAULT true NOT NULL,
	`next_feed_reminder_enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
