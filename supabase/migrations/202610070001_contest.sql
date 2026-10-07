CREATE TABLE IF NOT EXISTS public.event (id integer PRIMARY KEY CHECK(id=1), state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','open','paused','closed')));
CREATE TABLE IF NOT EXISTS public.entries (id text PRIMARY KEY,name text NOT NULL,costume text NOT NULL,category text NOT NULL CHECK(category IN ('Most Creative/Original','Funniest','Best Team/Group Costume')),description text NOT NULL DEFAULT '',tagline text NOT NULL DEFAULT '',image text NOT NULL DEFAULT '',published integer NOT NULL DEFAULT 0 CHECK(published IN (0,1)),sample integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS public.codes (hash text PRIMARY KEY,created text NOT NULL);
CREATE TABLE IF NOT EXISTS public.votes (id text PRIMARY KEY,code text NOT NULL REFERENCES public.codes(hash),category text NOT NULL,entry text NOT NULL REFERENCES public.entries(id));
CREATE UNIQUE INDEX IF NOT EXISTS one_vote_per_category ON public.votes(code,category);
CREATE TABLE IF NOT EXISTS public.draws(category text PRIMARY KEY,winner text NOT NULL,tied text NOT NULL,time text NOT NULL);
INSERT INTO public.event(id,state) VALUES(1,'draft') ON CONFLICT DO NOTHING;
ALTER TABLE public.event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draws ENABLE ROW LEVEL SECURITY;
-- All contest access goes through the authenticated Next.js server, never browser SQL.
