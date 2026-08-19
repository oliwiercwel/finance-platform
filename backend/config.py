import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    NEWS_API_KEY: str = os.environ.get("NEWS_API_KEY", "96c4e834035b43c893accddbc849da98")
    ALPHA_VANTAGE_KEY: str = os.environ.get("ALPHA_VANTAGE_KEY", "ZRSYOFXKHQR8PGLG")
    GNEWS_API_KEY: str = os.environ.get("GNEWS_API_KEY", "27a58d075beb773e8c5fe5e77a392953")
    FRED_API_KEY: str = os.environ.get("FRED_API_KEY", "a96d79ed795065f307d5f82c4f699737")
    FMP_API_KEY: str = os.environ.get("FMP_API_KEY", "0evzugPpumZ3XnamDK69FfQQuiq8xNES")

    CACHE_TTL_SECONDS: int = 30 * 60
    REQUEST_TIMEOUT: int = 15
    MAX_RETRIES: int = 3
    BACKOFF_BASE: float = 0.5

    NVIDIA_API_KEY: str = os.environ.get("NVIDIA_API_KEY", "")
    NVIDIA_BASE_URL: str = os.environ.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")
    NVIDIA_MODEL: str = os.environ.get("NVIDIA_MODEL", "nvidia/nemotron-3-ultra-550b-a55b")
    NVIDIA_TEMPERATURE: float = float(os.environ.get("NVIDIA_TEMPERATURE", "0.2"))


config = Config()

