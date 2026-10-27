"""Keep one copy of the background collectors while serving public reads."""
# Extra processes would duplicate collectors, source budgets and cached state.
workers = 1
worker_class = "gthread"
# Middleware admits at most six noncritical requests, including serial waiters.
# Keep two of the eight serving threads available for GET/HEAD page/static reads.
threads = 8
