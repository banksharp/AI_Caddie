from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
import anthropic
import os
from dotenv import load_dotenv
from database import SessionLocal, User

load_dotenv()
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

app = FastAPI()

# Input schemas
class ClubSetupRequest(BaseModel):
    email: str
    clubs: dict  # e.g., {"Driver": 250, "7-Iron": 150}

class ClubRecommendationRequest(BaseModel):
    email: str
    distance: float
    lie: str
    wind: str

class CourseStrategyRequest(BaseModel):
    email: str
    hole_par: str
    hole_length: str
    hazards: str
    hole_shape: str

# Database dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.post("/api/setup-clubs")
async def setup_clubs(request: ClubSetupRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == request.email).first()
    if not user:
        user = User(email=request.email, clubs=request.clubs)
        db.add(user)
    else:
        user.clubs = request.clubs
    db.commit()
    return {"message": "Club distances saved", "clubs": request.clubs}

@app.post("/api/club-recommendation")
async def club_recommendation(request: ClubRecommendationRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == request.email).first()
    if not user or not user.clubs:
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
async def course_strategy(request: CourseStrategyRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == request.email).first()
    if not user or not user.clubs:
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