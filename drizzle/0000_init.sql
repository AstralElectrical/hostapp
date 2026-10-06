CREATE TABLE "business_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens" integer NOT NULL,
	"closes" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"guest_id" uuid,
	"vapi_call_id" text,
	"from_phone" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_sec" integer,
	"language" text,
	"topic" text,
	"outcome" text,
	"after_hours" boolean DEFAULT false NOT NULL,
	"sentiment" text,
	"summary" text,
	"ended_reason" text,
	"transcript" jsonb,
	"recording_url" text,
	"test" boolean DEFAULT false NOT NULL,
	CONSTRAINT "calls_vapi_call_id_unique" UNIQUE("vapi_call_id")
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"email" text,
	"language" text,
	"notes" text,
	"call_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hours_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"closed" boolean DEFAULT true NOT NULL,
	"opens" integer,
	"closes" integer,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"answer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"category" text DEFAULT 'Menu' NOT NULL,
	"name" text NOT NULL,
	"name_es" text,
	"description" text,
	"price_cents" integer NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allergens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"guest_id" uuid,
	"call_id" uuid,
	"reason" text NOT NULL,
	"name" text,
	"phone" text NOT NULL,
	"body" text NOT NULL,
	"callback_by" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"guest_id" uuid,
	"call_id" uuid,
	"code" text NOT NULL,
	"kind" text DEFAULT 'pickup' NOT NULL,
	"lines" jsonb NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"tax_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"address" text,
	"notes" text,
	"ready_at" timestamp with time zone,
	"status" text DEFAULT 'awaiting_payment' NOT NULL,
	"payment" text DEFAULT 'link' NOT NULL,
	"payment_url" text,
	"stripe_session_id" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"guest_id" uuid,
	"call_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"party_size" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"notes" text,
	"deposit_cents" integer DEFAULT 0 NOT NULL,
	"deposit_url" text,
	"stripe_session_id" text,
	"deposit_paid_at" timestamp with time zone,
	"running_late_minutes" integer,
	"source" text DEFAULT 'phone' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"phone" text,
	"address" text,
	"voice_name" text DEFAULT 'Casia' NOT NULL,
	"greeting_es" text,
	"greeting_en" text,
	"owner_name" text,
	"owner_phone" text,
	"owner_email" text,
	"orders_enabled" boolean DEFAULT true NOT NULL,
	"pickup_enabled" boolean DEFAULT true NOT NULL,
	"delivery_enabled" boolean DEFAULT false NOT NULL,
	"delivery_fee_cents" integer DEFAULT 0 NOT NULL,
	"pay_at_pickup_allowed" boolean DEFAULT true NOT NULL,
	"prep_minutes" integer DEFAULT 20 NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"reservations_enabled" boolean DEFAULT true NOT NULL,
	"capacity_covers" integer DEFAULT 40 NOT NULL,
	"turn_minutes" integer DEFAULT 90 NOT NULL,
	"slot_minutes" integer DEFAULT 30 NOT NULL,
	"max_party_auto" integer DEFAULT 8 NOT NULL,
	"deposit_party_min" integer DEFAULT 6 NOT NULL,
	"deposit_per_person_cents" integer DEFAULT 0 NOT NULL,
	"last_seating_minutes" integer DEFAULT 60 NOT NULL,
	"late_grace_minutes" integer DEFAULT 15 NOT NULL,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stripe_account_id" text,
	"live" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "transfer_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"label" text NOT NULL,
	"target_phone" text,
	"target_email" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"guest_id" uuid,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"party_size" integer NOT NULL,
	"wanted_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hours_exceptions" ADD CONSTRAINT "hours_exceptions_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_rules" ADD CONSTRAINT "transfer_rules_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bh_rest_idx" ON "business_hours" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "call_rest_started" ON "calls" USING btree ("restaurant_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_rest_phone" ON "guests" USING btree ("restaurant_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "hx_rest_day" ON "hours_exceptions" USING btree ("restaurant_id","day");--> statement-breakpoint
CREATE INDEX "ki_rest_idx" ON "knowledge_items" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "mi_rest_idx" ON "menu_items" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "msg_rest_status" ON "messages" USING btree ("restaurant_id","status");--> statement-breakpoint
CREATE INDEX "order_rest_created" ON "orders" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE INDEX "resv_rest_starts" ON "reservations" USING btree ("restaurant_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tr_rest_reason" ON "transfer_rules" USING btree ("restaurant_id","reason");--> statement-breakpoint
CREATE INDEX "wl_rest_idx" ON "waitlist" USING btree ("restaurant_id","wanted_at");