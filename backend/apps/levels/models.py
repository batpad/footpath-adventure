import uuid

from django.db import models


def new_token() -> str:
    return uuid.uuid4().hex


class GeneratedLevel(models.Model):
    """A generated level, kept so runs can be replayed and in-game reports
    can be mapped back from route distance to a real segment."""

    token = models.CharField(max_length=32, unique=True, default=new_token)
    spec = models.JSONField()
    # [{key, start_m, end_m, reversed}] in route order, for report mapping.
    segment_offsets = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.token
