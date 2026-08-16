.PHONY: dev backend frontend ingest test migrate

# Run backend (Django :8000) and frontend (Vite :5173) together.
dev:
	(cd backend && uv run python manage.py runserver 8000) & \
	(cd frontend && npm run dev) & \
	wait

backend:
	cd backend && uv run python manage.py runserver 8000

frontend:
	cd frontend && npm run dev

migrate:
	cd backend && uv run python manage.py migrate

ingest:
	cd backend && uv run python manage.py ingest_osm ../data/bandra-west.osm --replace

test:
	cd backend && uv run pytest -q
	cd frontend && npm test
