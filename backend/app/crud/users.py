from sqlalchemy.orm import Session
from app.models.user import User
from app.schemas.user import UserCreate
import hashlib
import hmac
import os

# Passwords nuevos: PBKDF2-HMAC-SHA256 con sal (formato "pbkdf2$<sal>$<dk>").
# Verificación retrocompatible con los hashes SHA-256 sin sal previos.
_PBKDF_ROUNDS = 200_000

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF_ROUNDS)
    return f"pbkdf2${salt.hex()}${dk.hex()}"

def get_user_by_username(db: Session, username: str):
    return db.query(User).filter(User.username == username).first()

def get_user_by_email(db: Session, email: str):
    return db.query(User).filter(User.email == email).first()

def create_user(db: Session, user: UserCreate):
    hashed_password = hash_password(user.password)
    db_user = User(
        email=user.email,
        username=user.username,
        hashed_password=hashed_password
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

def verify_password(password: str, hashed_password: str) -> bool:
    if hashed_password and hashed_password.startswith("pbkdf2$"):
        try:
            _, salt_hex, dk_hex = hashed_password.split("$", 2)
            dk = hashlib.pbkdf2_hmac(
                "sha256", password.encode(), bytes.fromhex(salt_hex), _PBKDF_ROUNDS
            )
            return hmac.compare_digest(dk.hex(), dk_hex)
        except Exception:
            return False
    # Legacy SHA-256 sin sal — compatibilidad hacia atrás, comparación constante.
    legacy = hashlib.sha256(password.encode()).hexdigest()
    return hmac.compare_digest(legacy, hashed_password or "")
