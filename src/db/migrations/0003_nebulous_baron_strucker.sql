CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`clientId` text NOT NULL,
	`platform` text NOT NULL,
	`scheduledDate` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`content` text NOT NULL,
	`photoId` text,
	`reasoning` text NOT NULL,
	`publishAt` integer,
	`rejectionCount` integer DEFAULT 0 NOT NULL,
	`approvedAt` integer,
	`rejectedAt` integer,
	`publishedAt` integer,
	`publishError` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`photoId`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `posts_client_date_idx` ON `posts` (`clientId`,`scheduledDate`);--> statement-breakpoint
CREATE INDEX `posts_status_publish_idx` ON `posts` (`status`,`publishAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `posts_client_date_platform_idx` ON `posts` (`clientId`,`scheduledDate`,`platform`);