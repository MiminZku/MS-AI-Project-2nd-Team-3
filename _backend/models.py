from sqlalchemy import Column, String, Boolean, DateTime, Integer, Text, ForeignKey, func
from sqlalchemy.orm import relationship
from database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(String(50), primary_key=True, index=True)
    is_muted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Admin(Base):
    __tablename__ = "admins"
    id = Column(String(50), primary_key=True, index=True)
    password = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Report(Base):
    __tablename__ = "reports"
    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    reporter_id = Column(String(50), ForeignKey("users.id", ondelete="CASCADE"))
    reported_id = Column(String(50), ForeignKey("users.id", ondelete="CASCADE"))
    status = Column(String(50), default="PENDING")
    content_type = Column(String(20))
    content_path = Column(Text)

class Sanction(Base):
    __tablename__ = "sanctions"
    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    user_id = Column(String(50), ForeignKey("users.id", ondelete="CASCADE"))
    ai_result = Column(Text)
    type = Column(String(50), nullable=False)
    duration_days = Column(Integer, nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)

class Appeal(Base):
    __tablename__ = "appeals"
    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"))
    user_id = Column(String(50), ForeignKey("users.id", ondelete="CASCADE"))
    reason = Column(Text, nullable=False)
    status = Column(String(50), default="PENDING")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
