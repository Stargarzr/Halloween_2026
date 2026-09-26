import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const event = sqliteTable('event', { id: integer('id').primaryKey(), state: text('state').notNull().default('draft') });
export const entries = sqliteTable('entries', {id:text('id').primaryKey(), name:text('name').notNull(), costume:text('costume').notNull(), category:text('category').notNull(), description:text('description').notNull().default(''), tagline:text('tagline').notNull().default(''), image:text('image').notNull().default(''), published:integer('published').notNull().default(0), sample:integer('sample').notNull().default(0)});
export const codes = sqliteTable('codes',{hash:text('hash').primaryKey(),created:text('created').notNull()});
export const votes = sqliteTable('votes',{id:text('id').primaryKey(),code:text('code').notNull().references(()=>codes.hash),category:text('category').notNull(),entry:text('entry').notNull().references(()=>entries.id)},t=>[uniqueIndex('one_vote_per_category').on(t.code,t.category)]);
export const draws = sqliteTable('draws',{category:text('category').primaryKey(),winner:text('winner').notNull(),tied:text('tied').notNull(),time:text('time').notNull()});
