from app import create_app
import os

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5274))
    # bind to 127.0.0.1 only — never exposed externally.
    # use_reloader=False: the Werkzeug reloader forks a second python.exe that,
    # on Windows, regularly orphans and keeps holding the port after the window
    # closes — the #1 cause of "address already in use" on the next launch.
    # Set HEARTH_RELOAD=1 if you want auto-reload while actively editing backend code.
    use_reloader = os.environ.get("HEARTH_RELOAD") == "1"
    app.run(host="127.0.0.1", port=port, debug=True, use_reloader=use_reloader)
