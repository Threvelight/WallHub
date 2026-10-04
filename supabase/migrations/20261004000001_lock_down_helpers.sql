-- Helpers used by RLS policies stay callable by signed-in users only; trigger
-- functions are never called directly (triggers still fire without EXECUTE).
revoke execute on function public.current_household_id()                from public, anon;
revoke execute on function public.is_household_owner()                  from public, anon;
grant  execute on function public.current_household_id()                to authenticated;
grant  execute on function public.is_household_owner()                  to authenticated;
revoke execute on function public.grocery_items_check_household()       from public, anon, authenticated;
revoke execute on function public.recipe_ingredients_check_household()  from public, anon, authenticated;
revoke execute on function public.touch_updated_at()                    from public, anon, authenticated;
