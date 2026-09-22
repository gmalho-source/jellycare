CREATE TABLE "scheduler_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"last_tick_at" timestamp with time zone NOT NULL,
	"last_healthy_tick_at" timestamp with time zone,
	"last_enqueue_at" timestamp with time zone,
	"considered" integer DEFAULT 0 NOT NULL,
	"enqueued" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_error_at" timestamp with time zone
);
