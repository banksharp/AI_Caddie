from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta, timezone

import anthropic
import os
from dotenv import load_dotenv
from jose import JWTError, jwt
from passlib.context import CryptContext

from database import SessionLocal, User, Round, Hole

load_dotenv()
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

app = FastAPI()


# --- Auth settings ---
SECRET_KEY = os.getenv("SECRET_KEY", "CHANGE_ME_SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 1 day

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# Input schemas
class ClubSetupRequest(BaseModel):
    clubs: dict  # e.g., {"Driver": 250, "7-Iron": 150}

class ClubRecommendationRequest(BaseModel):
    distance: float
    lie: str
    wind: str

class CourseStrategyRequest(BaseModel):
    hole_par: str
    hole_length: str
    hazards: str
    hole_shape: str


class StartRoundRequest(BaseModel):
    course_name: Optional[str] = None


class HoleUpdateRequest(BaseModel):
    round_id: int
    hole_number: int
    strokes: int
    putts: Optional[int] = None
    fairway_hit: Optional[bool] = None
    gir: Optional[bool] = None
    notes: Optional[str] = None


class HoleSummary(BaseModel):
    hole_number: int
    strokes: int
    putts: Optional[int] = None
    fairway_hit: Optional[bool] = None
    gir: Optional[bool] = None
    notes: Optional[str] = None


class RoundSummary(BaseModel):
    round_id: int
    course_name: Optional[str] = None
    started_at: str
    total_score: Optional[int] = None
    holes: List[HoleSummary]


class UserCreate(BaseModel):
    email: str
    password: str


class UserLogin(BaseModel):
    email: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

# Database dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _bool_to_int(value: Optional[bool]) -> Optional[int]:
    if value is None:
        return None
    return 1 if value else 0


def _int_to_bool(value: Optional[int]) -> Optional[bool]:
    if value is None:
        return None
    return bool(value)


def get_current_user(email: str, db: Session) -> User:
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication credentials")
    return user


def get_user_from_token(token: str, db: Session) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    return get_current_user(email=email, db=db)


@app.post("/api/register", response_model=Token)
async def register_user(request: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == request.email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    user = User(
        email=request.email,
        password_hash=get_password_hash(request.password),
        clubs={},
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    access_token = create_access_token(data={"sub": user.email})
    return Token(access_token=access_token)


@app.post("/api/login", response_model=Token)
async def login_user(request: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == request.email).first()
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")

    access_token = create_access_token(data={"sub": user.email})
    return Token(access_token=access_token)


def get_current_user_from_token(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    return get_user_from_token(token, db)


@app.post("/api/setup-clubs")
async def setup_clubs(
    request: ClubSetupRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    current_user.clubs = request.clubs
    db.commit()
    return {"message": "Club distances saved", "clubs": request.clubs}

@app.post("/api/club-recommendation")
async def club_recommendation(
    request: ClubRecommendationRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    user = current_user
    if not user.clubs:
        raise HTTPException(status_code=400, detail="Club distances not set up")
    
    prompt = f"""
    I need a club recommendation for my next golf shot. Here are my details:
    My club distances:
    """
    for club, distance in user.clubs.items():
        prompt += f"{club}: {distance} yards\n"
    
    prompt += f"""Current situation:
    - Distance to hole: {request.distance} yards
    - Current lie: {request.lie}
    - Wind conditions: {request.wind}
    
    Please recommend the best club for this shot and explain your reasoning.
    Also provide any tips for executing this shot successfully."""
    
    response = client.messages.create(
        model="claude-3-7-sonnet-20250219",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )
    
    return {"advice": response.content[0].text, "status": "success"}

@app.post("/api/course-strategy")
async def course_strategy(
    request: CourseStrategyRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    user = current_user
    if not user.clubs:
        raise HTTPException(status_code=400, detail="Club distances not set up")
    
    prompt = f"""
    I need advice on how to play this golf hole strategically:
    
    Hole details:
    - Par: {request.hole_par}
    - Length: {request.hole_length} yards
    - Shape: {request.hole_shape}
    - Hazards: {request.hazards}
    
    My club distances:
    """
    for club, distance in user.clubs.items():
        prompt += f"{club}: {distance} yards\n"
    
    prompt += """Please provide a hole strategy that covers:
    1. What club(s) to use off the tee
    2. Where to aim for each shot
    3. How to handle the approach to the green
    4. What risks to avoid
    5. Any specific shot shapes that would be beneficial
    """
    
    response = client.messages.create(
        model="claude-3-7-sonnet-20250219",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )
    
    return {"advice": response.content[0].text, "status": "success"}


@app.post("/api/start-round")
async def start_round(
    request: StartRoundRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    new_round = Round(user_id=current_user.id, course_name=request.course_name)
    db.add(new_round)
    db.commit()
    db.refresh(new_round)

    return {
        "round_id": new_round.id,
        "course_name": new_round.course_name,
        "started_at": new_round.started_at.isoformat() if new_round.started_at else None,
    }


@app.post("/api/add-hole", response_model=RoundSummary)
async def add_hole(
    request: HoleUpdateRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    round_obj = db.query(Round).filter(Round.id == request.round_id).first()
    if not round_obj:
        raise HTTPException(status_code=404, detail="Round not found")

    if round_obj.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not allowed to modify this round")

    hole = Hole(
        round_id=request.round_id,
        hole_number=request.hole_number,
        strokes=request.strokes,
        putts=request.putts,
        fairway_hit=_bool_to_int(request.fairway_hit),
        gir=_bool_to_int(request.gir),
        notes=request.notes,
    )
    db.add(hole)

    # Recalculate total score for the round
    db.flush()
    total = db.query(func.sum(Hole.strokes)).filter(Hole.round_id == request.round_id).scalar()
    round_obj.total_score = int(total) if total is not None else None

    db.commit()
    db.refresh(round_obj)

    holes = (
        db.query(Hole)
        .filter(Hole.round_id == request.round_id)
        .order_by(Hole.hole_number)
        .all()
    )

    hole_summaries = [
        HoleSummary(
            hole_number=h.hole_number,
            strokes=h.strokes,
            putts=h.putts,
            fairway_hit=_int_to_bool(h.fairway_hit),
            gir=_int_to_bool(h.gir),
            notes=h.notes,
        )
        for h in holes
    ]

    return RoundSummary(
        round_id=round_obj.id,
        course_name=round_obj.course_name,
        started_at=round_obj.started_at.isoformat() if round_obj.started_at else "",
        total_score=round_obj.total_score,
        holes=hole_summaries,
    )


@app.get("/api/rounds", response_model=List[RoundSummary])
async def list_rounds(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    rounds = (
        db.query(Round)
        .filter(Round.user_id == current_user.id)
        .order_by(Round.started_at.desc())
        .all()
    )

    summaries: List[RoundSummary] = []
    for r in rounds:
        holes = (
            db.query(Hole)
            .filter(Hole.round_id == r.id)
            .order_by(Hole.hole_number)
            .all()
        )
        hole_summaries = [
            HoleSummary(
                hole_number=h.hole_number,
                strokes=h.strokes,
                putts=h.putts,
                fairway_hit=_int_to_bool(h.fairway_hit),
                gir=_int_to_bool(h.gir),
                notes=h.notes,
            )
            for h in holes
        ]

        summaries.append(
            RoundSummary(
                round_id=r.id,
                course_name=r.course_name,
                started_at=r.started_at.isoformat() if r.started_at else "",
                total_score=r.total_score,
                holes=hole_summaries,
            )
        )

    return summaries