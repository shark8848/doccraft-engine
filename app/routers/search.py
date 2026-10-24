from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.deps import Identity, get_identity
from app.es import SearchUnavailable

router = APIRouter(prefix="/search", tags=["search"])


@router.get("")
async def search_documents(
    request: Request,
    q: str = Query(default="", max_length=300),
    limit: int = Query(default=20, ge=1, le=50),
    identity: Identity = Depends(get_identity),
) -> dict:
    es = request.app.state.es
    try:
        items = await es.search(identity.tenant_id, q, limit=limit)
    except SearchUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "SEARCH_UNAVAILABLE", "message": str(exc)},
        ) from exc
    return {"query": q, "items": items}
