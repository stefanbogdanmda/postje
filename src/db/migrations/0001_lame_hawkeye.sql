CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`businessName` text NOT NULL,
	`location` text,
	`industry` text,
	`businessType` text,
	`productsServices` text,
	`logoUrl` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_userId_unique` ON `clients` (`userId`);