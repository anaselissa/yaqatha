-- ============================================================================
-- يَقَظَة — الهجرة 7: إعادة ترتيب خطوات مسودة إصدار (A3)
-- لماذا RPC؟ قيد الفرادة (version_id, position) مؤجَّل داخل المعاملة الواحدة فقط، وطلبات REST المنفصلة
-- (تبديل موضعين مثلًا) تتصادم فيه. هذه الدالة تعيد الترتيب كله في معاملة واحدة.
-- ============================================================================
create function public.reorder_steps(p_version_id uuid, p_step_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare vs public.version_status; n int;
begin
  perform public.require_staff();
  select status into vs from public.path_versions where id = p_version_id;
  if not found then raise exception 'version not found' using errcode = 'P0002'; end if;
  if vs <> 'draft' then
    raise exception 'only a draft version can be reordered' using errcode = 'P0001';
  end if;
  select count(*) into n from public.steps where version_id = p_version_id;
  if n <> coalesce(array_length(p_step_ids, 1), 0)
     or (select count(distinct x) from unnest(p_step_ids) x) <> n
     or exists (select 1 from unnest(p_step_ids) x
                 where not exists (select 1 from public.steps s where s.id = x and s.version_id = p_version_id)) then
    raise exception 'the list must contain each step of the version exactly once' using errcode = 'P0001';
  end if;
  update public.steps s set position = o.ord
    from unnest(p_step_ids) with ordinality as o(id, ord)
   where s.id = o.id and s.version_id = p_version_id;
end $$;

revoke execute on function public.reorder_steps(uuid, uuid[]) from public, anon, authenticated;
grant  execute on function public.reorder_steps(uuid, uuid[]) to authenticated;
