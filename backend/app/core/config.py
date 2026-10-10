from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./app.db"
    media_dir: str = "./media"
    library_dirs: str = ""  # comma-separated; default for the library_dirs runtime setting
    max_upload_mb: int = 500
    frontend_dist: str = ""  # path of the built frontend (frontend/dist); empty = API only (development uses Vite)
    lrclib_base_url: str = "https://lrclib.net/api"
    musicbrainz_base_url: str = "https://musicbrainz.org/ws/2"
    coverart_base_url: str = "https://coverartarchive.org"
    path_access: str = "local"  # who may browse folders and import by path: "local" = this machine and the administrator; "open" = anyone who can use the app
    covers_dir: str = ""  # where covers found online are kept; empty = a "covers" folder next to MEDIA_DIR


settings = Settings()
