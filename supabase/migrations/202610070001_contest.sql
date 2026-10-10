CREATE TABLE IF NOT EXISTS public.event (id integer PRIMARY KEY CHECK(id=1), state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','open','paused','closed')));
CREATE TABLE IF NOT EXISTS public.entries (id text PRIMARY KEY,name text NOT NULL,costume text NOT NULL,category text NOT NULL CHECK(category IN ('Most Creative/Original','Funniest','Best Team/Group Costume')),description text NOT NULL DEFAULT '',tagline text NOT NULL DEFAULT '',image text NOT NULL DEFAULT '',published integer NOT NULL DEFAULT 0 CHECK(published IN (0,1)),UNIQUE (id,category,published));
CREATE TABLE IF NOT EXISTS public.codes (hash text PRIMARY KEY,created text NOT NULL);
-- votes.published is always 1 and exists only so the composite foreign key ties each vote to the entry's category and published
-- state: while votes exist the engine refuses re-categorizing, unpublishing, or deleting the entry (23503), with no application locking.
CREATE TABLE IF NOT EXISTS public.votes (id text PRIMARY KEY,code text NOT NULL REFERENCES public.codes(hash),category text NOT NULL,entry text NOT NULL REFERENCES public.entries(id),published integer NOT NULL DEFAULT 1 CHECK (published = 1),FOREIGN KEY (entry,category,published) REFERENCES public.entries(id,category,published) ON UPDATE RESTRICT ON DELETE RESTRICT);
CREATE UNIQUE INDEX IF NOT EXISTS one_vote_per_category ON public.votes(code,category);
CREATE TABLE IF NOT EXISTS public.draws(category text PRIMARY KEY,winner text NOT NULL,tied text NOT NULL,time text NOT NULL);
INSERT INTO public.event(id,state) VALUES(1,'draft') ON CONFLICT DO NOTHING;
ALTER TABLE public.event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draws ENABLE ROW LEVEL SECURITY;
-- All contest access goes through the authenticated Next.js server, never browser SQL.
