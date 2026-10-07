REVOKE ALL ON public.event,public.entries,public.codes,public.votes,public.draws FROM anon,authenticated;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('costume-photos','costume-photos',false,4194304,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=4194304,allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'];
-- No public or authenticated-user storage policies. Only the server service key accesses photos.
