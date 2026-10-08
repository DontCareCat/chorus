from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./app.db"
    media_dir: str = "./media"
    library_dirs: str = ""  # comma-separated; default for the library_dirs runtime setting
    max_upload_mb: int = 500
    frontend_dist: str = ""  # path of the built frontend (frontend/dist); empty = API only (development uses Vite)
    lrclib_base_url: str = "https://lrclib.net/api"


settings = Settings()
