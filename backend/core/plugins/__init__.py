"""Plugin registry — maps platform names to their async analyze functions."""

from .github import analyze as github_analyze
from .reddit import analyze as reddit_analyze
from .twitter import analyze as twitter_analyze
from .telegram import analyze as telegram_analyze

PLUGINS = {
    "github": github_analyze,
    "reddit": reddit_analyze,
    "twitter": twitter_analyze,
    "x": twitter_analyze,
    "telegram": telegram_analyze,
}
