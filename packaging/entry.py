"""PyInstaller entry point of the packaged app."""
import sys

from app.launcher import main

if __name__ == "__main__":
    sys.exit(main())
