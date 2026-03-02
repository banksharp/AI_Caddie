from sqlalchemy import create_engine, Column, Integer, String, JSON, ForeignKey, DateTime, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:RedBrickBong420@localhost/golf_caddie")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# User data model
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String, nullable=False)
    clubs = Column(JSON)  # Store club distances as JSON

    rounds = relationship("Round", back_populates="user", cascade="all, delete-orphan")


class Round(Base):
    __tablename__ = "rounds"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    course_name = Column(String, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    total_score = Column(Integer, nullable=True)  # optional cached total

    user = relationship("User", back_populates="rounds")
    holes = relationship("Hole", back_populates="round", cascade="all, delete-orphan")


class Hole(Base):
    __tablename__ = "holes"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, ForeignKey("rounds.id"), index=True, nullable=False)
    hole_number = Column(Integer, nullable=False)
    strokes = Column(Integer, nullable=False)
    putts = Column(Integer, nullable=True)
    fairway_hit = Column(Integer, nullable=True)  # 1 = True, 0 = False / None
    gir = Column(Integer, nullable=True)          # 1 = True, 0 = False / None
    notes = Column(String, nullable=True)

    round = relationship("Round", back_populates="holes")

# Create tables
Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()