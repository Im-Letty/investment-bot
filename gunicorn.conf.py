"""Keep one copy of the background collectors while serving public reads."""
# Extra processes would duplicate collectors, source budgets and cached state.
workers = 1
worker_class = "gthread"
# At most six selected market quotes can wait upstream; leave room for the page.
threads = 8
