from rest_framework.permissions import SAFE_METHODS, BasePermission


def is_admin(user):
    return user.is_authenticated and user.role == user.Role.ADMIN


class IsAdminOrReadOnly(BasePermission):
    """Anyone authenticated can read; only ADMIN can write."""

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return is_admin(request.user)


class IsAdminOnly(BasePermission):
    def has_permission(self, request, view):
        return is_admin(request.user)


class IsAdminOrOwnerForWrite(BasePermission):
    """Both roles can read and create. ADMIN can edit/delete anything;
    INVESTOR can edit/delete only objects with created_by == self."""

    def has_permission(self, request, view):
        return request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        if is_admin(request.user):
            return True
        return obj.created_by_id == request.user.id


class IsAdminOrCreateForClient(BasePermission):
    """Anyone authenticated can read or create a client (inline creation from a
    quick job/expense form). Only ADMIN can edit or delete one."""

    def has_permission(self, request, view):
        if request.method in (*SAFE_METHODS, "POST"):
            return request.user.is_authenticated
        return is_admin(request.user)


class IsAdminOrSelfInvestor(BasePermission):
    """For per-investor capital detail: ADMIN sees anyone's, INVESTOR only their own."""

    def has_object_permission(self, request, view, obj):
        if is_admin(request.user):
            return True
        investor = getattr(request.user, "investor", None)
        return investor is not None and investor.id == obj.id
