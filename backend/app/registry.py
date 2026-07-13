from __future__ import annotations

from typing import Generic, TypeVar

from .errors import DuplicateRegistrationError, UnknownRegistrationError


T = TypeVar("T")


class NamedRegistry(Generic[T]):
    def __init__(self, kind: str) -> None:
        self._kind = kind
        self._items: dict[str, T] = {}

    @staticmethod
    def _normalize(name: str) -> str:
        return name.strip().lower()

    def register(self, name: str, item: T) -> None:
        key = self._normalize(name)
        if not key:
            raise ValueError("注册名称不能为空")
        if key in self._items:
            raise DuplicateRegistrationError(f"{self._kind} 已注册：{key}")
        self._items[key] = item

    def get(self, name: str) -> T:
        key = self._normalize(name)
        try:
            return self._items[key]
        except KeyError as exc:
            raise UnknownRegistrationError(f"未知{self._kind}：{key}") from exc

    def names(self) -> list[str]:
        return sorted(self._items)
