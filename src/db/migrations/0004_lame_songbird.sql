ALTER TABLE `posts` ADD `firstSeenAt` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `alertedAt` integer;--> statement-breakpoint
CREATE INDEX `posts_stale_alert_idx` ON `posts` (`status`,`alertedAt`,`firstSeenAt`);