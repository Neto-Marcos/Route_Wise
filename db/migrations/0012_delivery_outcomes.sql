-- Resultado operacional registrado em cada tentativa de entrega.
ALTER TABLE route_stops
  ADD COLUMN IF NOT EXISTS delivery_outcome text NOT NULL DEFAULT 'pending';

ALTER TABLE delivery_events
  ADD COLUMN IF NOT EXISTS occurrence text NOT NULL DEFAULT 'entregue';

CREATE INDEX IF NOT EXISTS route_stops_outcome_idx
  ON route_stops(route_id, delivery_outcome);
