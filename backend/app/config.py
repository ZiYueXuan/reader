"""运行期配置。全部可通过 READER_ 前缀的环境变量覆盖。"""

from __future__ import annotations

from functools import cached_property
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="READER_",
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    data_dir: Path = BASE_DIR / "data"
    """书籍文件、封面、SQLite 数据库的根目录。"""

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    """允许跨域的前端来源，逗号分隔。"""

    token: str = ""
    """可选的访问口令。为空时不校验，适合本机自用。"""

    @cached_property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @cached_property
    def db_path(self) -> Path:
        return self.data_dir / "reader.db"

    @cached_property
    def books_dir(self) -> Path:
        return self.data_dir / "books"

    @cached_property
    def covers_dir(self) -> Path:
        return self.data_dir / "covers"

    @cached_property
    def db_url(self) -> str:
        return f"sqlite:///{self.db_path.as_posix()}"

    def ensure_dirs(self) -> None:
        for path in (self.data_dir, self.books_dir, self.covers_dir):
            path.mkdir(parents=True, exist_ok=True)


settings = Settings()
