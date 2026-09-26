CREATE TABLE `codes` (
	`hash` text PRIMARY KEY NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `draws` (
	`category` text PRIMARY KEY NOT NULL,
	`winner` text NOT NULL,
	`tied` text NOT NULL,
	`time` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`costume` text NOT NULL,
	`category` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tagline` text DEFAULT '' NOT NULL,
	`image` text DEFAULT '' NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`sample` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event` (
	`id` integer PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `votes` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`category` text NOT NULL,
	`entry` text NOT NULL,
	FOREIGN KEY (`code`) REFERENCES `codes`(`hash`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_vote_per_category` ON `votes` (`code`,`category`);