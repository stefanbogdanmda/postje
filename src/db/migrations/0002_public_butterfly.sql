CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`clientId` text NOT NULL,
	`blobUrl` text NOT NULL,
	`originalFilename` text NOT NULL,
	`mimeType` text NOT NULL,
	`sizeBytes` integer NOT NULL,
	`analysis` text,
	`analyzedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
