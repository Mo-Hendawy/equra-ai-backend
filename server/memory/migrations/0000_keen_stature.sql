CREATE TABLE `decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`created_at` integer NOT NULL,
	`recommendation` text NOT NULL,
	`confidence` text NOT NULL,
	`reasoning` text NOT NULL,
	`inputs_hash` text NOT NULL,
	`fair_value` real,
	`price_at_rec` real,
	`invalidation_reason` text,
	`critic_weakness` text,
	`critic_severity` text,
	`critic_blocking` text,
	`outcome_5d` real,
	`outcome_30d` real,
	`outcome_90d` real,
	`scored_5d_at` integer,
	`scored_30d_at` integer,
	`scored_90d_at` integer
);
--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`created_at` integer NOT NULL,
	`lesson` text NOT NULL,
	`context` text NOT NULL,
	`valid_until` integer,
	`macro_regime` text,
	`decision_id` integer,
	`lance_episode_id` text,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `strategy_prompts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer NOT NULL,
	`prompt_text` text NOT NULL,
	`created_at` integer NOT NULL,
	`performance_score` real,
	`is_active` integer DEFAULT false NOT NULL
);
