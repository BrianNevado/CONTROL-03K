-- CONTROL 03K: cuotas por integrante y actividad.
-- Ejecuta este script en Supabase > SQL Editor antes de usar la nueva vista de detalle.

create table if not exists public.aportes_esperados (
  id uuid primary key default gen_random_uuid(),
  actividad_id uuid not null references public.actividades(id) on delete cascade,
  integrante_id uuid not null references public.integrantes(id) on delete cascade,
  monto_esperado numeric(12,2) not null default 0 check (monto_esperado >= 0),
  creado_en timestamptz not null default now(),
  unique (actividad_id, integrante_id)
);

create index if not exists aportes_esperados_actividad_idx
  on public.aportes_esperados (actividad_id);

alter table public.aportes_esperados enable row level security;

drop policy if exists "Aprobados pueden consultar aportes esperados" on public.aportes_esperados;
create policy "Aprobados pueden consultar aportes esperados"
  on public.aportes_esperados
  for select
  to authenticated
  using (public.usuario_aprobado());

drop policy if exists "Administradores gestionan aportes esperados" on public.aportes_esperados;
create policy "Administradores gestionan aportes esperados"
  on public.aportes_esperados
  for all
  to authenticated
  using (public.es_admin())
  with check (public.es_admin());

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.aportes_esperados to authenticated;
grant execute on function public.usuario_aprobado() to authenticated;
grant execute on function public.es_admin() to authenticated;

-- Nota: los pagos reales se guardan como filas independientes en public.movimientos
-- con tipo='aporte', actividad_id e integrante_id. Así se admiten varios pagos
-- parciales por persona. El estado Pendiente / Pago parcial / Pagado se calcula
-- comparando la suma de esos pagos con monto_esperado.
