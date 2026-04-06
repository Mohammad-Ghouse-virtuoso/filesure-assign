#!/usr/bin/env python3
"""
FileSure Data Ingestion Pipeline
Reads messy CSV, cleans data, inserts into MongoDB
"""

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pandas as pd
from dateutil import parser as date_parser

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# MongoDB Configuration
MONGO_URI = os.getenv("MONGODB_URI") or os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME = os.getenv("DB_NAME", "filesure")
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "companies")
USE_MONGOMOCK = os.getenv("USE_MONGOMOCK", "true").lower() == "true"

# Dynamic import based on configuration
try:
    if USE_MONGOMOCK:
        import mongomock as pymongo
        logger.info("Using mongomock (in-memory MongoDB) for testing")
    else:
        import pymongo
        logger.info("Using real MongoDB client")
except ImportError:
    import pymongo
    logger.info("Using real MongoDB client")

class DataCleaner:
    """Handle all data cleaning and validation"""
    
    @staticmethod
    def clean_status(status: Any) -> str:
        """Normalize status field to lowercase, handle inconsistencies"""
        if pd.isna(status) or not str(status).strip():
            return "unknown"
        
        status = str(status).strip().lower()
        
        # Map inconsistent formats to standard ones
        status_map = {
            "active": "active",
            "strike off": "strike_off",
            "strike_off": "strike_off",
            "under liq.": "under_liquidation",
            "under liquidation": "under_liquidation",
            "under liq": "under_liquidation",
            "dormant": "dormant",  # Observed in data but not in spec
        }
        
        # Try exact match first
        if status in status_map:
            return status_map[status]
        
        # Try fuzzy match
        for key, value in status_map.items():
            if key in status:
                return value
        
        return "unknown"
    
    @staticmethod
    def parse_date(date_str: Any) -> Optional[datetime]:
        """Parse mixed date formats (DD-MM-YYYY, YYYY/MM/DD, etc.)"""
        if pd.isna(date_str) or not str(date_str).strip():
            return None
        
        date_str = str(date_str).strip()
        
        try:
            # Use dateutil parser with dayfirst=True (for Indian format)
            parsed = date_parser.parse(date_str, dayfirst=True)
            return parsed
        except (ValueError, TypeError):
            logger.warning(f"Failed to parse date: {date_str}")
            return None
    
    @staticmethod
    def clean_paid_capital(capital: Any) -> float:
        """Extract numeric value from paid_up_capital field"""
        if pd.isna(capital) or not str(capital).strip():
            return 0.0
        
        capital_str = str(capital).strip()
        
        # Remove currency symbols, ■ character, spaces
        capital_str = re.sub(r'[₹Rs\s■.]', '', capital_str)
        
        # Remove commas
        capital_str = capital_str.replace(',', '')
        
        try:
            return float(capital_str)
        except ValueError:
            logger.warning(f"Failed to parse capital: {capital}")
            return 0.0
    
    @staticmethod
    def validate_email(email: Any) -> tuple[Optional[str], bool]:
        """Validate email, return (email_or_none, is_valid)"""
        if pd.isna(email) or not str(email).strip():
            return None, False
        
        email = str(email).strip()
        
        # Basic email regex
        email_regex = r'^[^\s@]+@[^\s@]+\.[^\s@]+$'
        
        # Check for obvious issues
        if ' ' in email or '@@' in email or email.startswith('@') or email.endswith('@'):
            logger.warning(f"Invalid email detected: {email}")
            return email, False
        
        if re.match(email_regex, email):
            return email, True
        else:
            logger.warning(f"Email validation failed: {email}")
            return email, False
    
    @staticmethod
    def parse_directors(director_1: Any, director_2: Any) -> List[str]:
        """Create array of director names"""
        directors = []
        
        if pd.notna(director_1) and str(director_1).strip():
            directors.append(str(director_1).strip())
        
        if pd.notna(director_2) and str(director_2).strip():
            directors.append(str(director_2).strip())
        
        return directors


class MongoDBIngestor:
    """Handle MongoDB operations"""
    
    def __init__(self, mongo_uri: str, db_name: str, collection_name: str):
        self.mongo_uri = mongo_uri
        self.db_name = db_name
        self.collection_name = collection_name
        self.client = None
        self.db = None
        self.collection = None
    
    def connect(self):
        """Connect to MongoDB"""
        try:
            self.client = pymongo.MongoClient(self.mongo_uri, serverSelectionTimeoutMS=5000)
            # Verify connection
            self.client.admin.command('ping')
            self.db = self.client[self.db_name]
            self.collection = self.db[self.collection_name]
            logger.info(f"Connected to MongoDB at {self.mongo_uri}")
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            raise

    def _require_collection(self):
        """Return the active collection or fail fast with a clear error."""
        if self.collection is None:
            raise RuntimeError("MongoDB collection is not initialized. Call connect() first.")
        return self.collection
    
    def drop_collection(self):
        """Drop existing collection for fresh ingest"""
        try:
            collection = self._require_collection()
            collection.drop()
            logger.info(f"Dropped existing collection: {self.collection_name}")
        except Exception as e:
            logger.warning(f"Failed to drop collection: {e}")
    
    def create_indexes(self):
        """Create database indexes for query performance"""
        try:
            collection = self._require_collection()
            # Compound index on status and state (most common filter pattern)
            collection.create_index([("status", 1), ("state", 1)])
            logger.info("Created compound index on (status, state)")
            
            # Single index on CIN for lookups
            collection.create_index([("cin", 1)], sparse=True)
            logger.info("Created sparse index on CIN")
            
            # Index on email for validation queries
            collection.create_index([("email_valid", 1)])
            logger.info("Created index on email_valid")
            
        except Exception as e:
            logger.error(f"Failed to create indexes: {e}")
            raise
    
    def insert_record(self, record: Dict[str, Any]) -> bool:
        """Insert single record, handle errors gracefully"""
        try:
            collection = self._require_collection()
            collection.insert_one(record)
            return True
        except Exception as e:
            logger.error(f"Failed to insert record {record.get('cin', 'UNKNOWN')}: {e}")
            return False
    
    def get_stats(self) -> Dict[str, Any]:
        """Get collection statistics"""
        collection = self._require_collection()
        by_status = {
            item["_id"] or "unknown": item["count"]
            for item in collection.aggregate([
                {"$group": {"_id": "$status", "count": {"$sum": 1}}},
            ])
        }
        by_state = {
            item["_id"] or "unknown": item["count"]
            for item in collection.aggregate([
                {"$group": {"_id": "$state", "count": {"$sum": 1}}},
            ])
        }
        return {
            "total_records": collection.count_documents({}),
            "by_status": by_status,
            "by_state": by_state,
            "invalid_emails": collection.count_documents({"email_valid": False}),
        }
    
    def export_to_json(self, filepath: str) -> bool:
        """Export collection to JSON file for Node.js to load"""
        try:
            collection = self._require_collection()
            documents = list(collection.find({}, {"_id": 0}))
            # Convert ObjectIds and dates to serializable format
            def json_serializer(obj):
                if isinstance(obj, datetime):
                    return obj.isoformat()
                raise TypeError(f"Type {type(obj)} not serializable")
            
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(documents, f, indent=2, default=json_serializer)
            logger.info(f"✓ Exported {len(documents)} records to {filepath}")
            return True
        except Exception as e:
            logger.error(f"Failed to export JSON: {e}")
            return False
    
    def close(self):
        """Close MongoDB connection"""
        if self.client:
            self.client.close()
            logger.info("Closed MongoDB connection")


def ingest_csv(csv_path: str, mongo_uri: str, db_name: str, collection_name: str):
    """Main ingestion pipeline"""
    
    logger.info(f"Starting ingestion from {csv_path}")
    
    # Initialize
    cleaner = DataCleaner()
    ingestor = MongoDBIngestor(mongo_uri, db_name, collection_name)
    
    try:
        # Connect to MongoDB
        ingestor.connect()
        ingestor.drop_collection()
        
        # Read CSV
        df = pd.read_csv(csv_path)
        logger.info(f"Loaded {len(df)} records from CSV")
        
        # Process each row
        inserted = 0
        skipped = 0
        quality_issues = []
        
        for row_number, (_, row) in enumerate(df.iterrows(), start=1):
            try:
                # Extract and clean fields
                cin = str(row.get('cin', '')).strip() if pd.notna(row.get('cin')) else None
                company_name = str(row.get('company_name', '')).strip() if pd.notna(row.get('company_name')) else None
                
                # Skip if both CIN and company name are missing
                if not cin and not company_name:
                    logger.warning(f"Row {row_number}: Missing both CIN and company name, skipping")
                    skipped += 1
                    continue
                
                # Clean fields
                status = cleaner.clean_status(row.get('status'))
                incorporation_date = cleaner.parse_date(row.get('incorporation_date'))
                state = str(row.get('state', '')).strip() if pd.notna(row.get('state')) else None
                directors = cleaner.parse_directors(row.get('director_1'), row.get('director_2'))
                paid_capital = cleaner.clean_paid_capital(row.get('paid_up_capital'))
                last_filing_date = cleaner.parse_date(row.get('last_filing_date'))
                email, email_valid = cleaner.validate_email(row.get('email'))
                
                # Build document
                document = {
                    "cin": cin if cin else None,
                    "company_name": company_name,
                    "status": status,
                    "incorporation_date": incorporation_date,
                    "state": state,
                    "directors": directors,
                    "paid_up_capital": paid_capital,
                    "last_filing_date": last_filing_date,
                    "email": email,
                    "email_valid": email_valid,
                    "data_quality": {
                        "notes": f"Row {row_number}",
                        "ingested_at": datetime.now(timezone.utc)
                    }
                }
                
                # Track quality issues
                if not cin:
                    quality_issues.append(f"Row {row_number}: Missing CIN")
                if not email_valid and email:
                    quality_issues.append(f"Row {row_number}: Invalid email {email}")
                if not incorporation_date:
                    quality_issues.append(f"Row {row_number}: Unparseable incorporation date")
                
                # Insert
                if ingestor.insert_record(document):
                    inserted += 1
                else:
                    skipped += 1
            
            except Exception as e:
                logger.error(f"Error processing row {row_number}: {e}")
                skipped += 1
                continue
        
        # Create indexes
        ingestor.create_indexes()
        
        # Export to JSON for Node.js
        ingestor.export_to_json("data.json")
        
        # Get statistics
        stats = ingestor.get_stats()
        
        # Report
        logger.info("\n" + "="*60)
        logger.info("INGESTION COMPLETE")
        logger.info("="*60)
        logger.info(f"Total records inserted: {inserted}")
        logger.info(f"Records skipped: {skipped}")
        logger.info(f"Total records in collection: {stats['total_records']}")
        logger.info(f"Invalid emails flagged: {stats['invalid_emails']}")
        logger.info(f"\nRecords by status: {stats['by_status']}")
        logger.info(f"\nQuality issues ({len(quality_issues)} total):")
        for issue in quality_issues[:10]:  # Show first 10
            logger.info(f"  - {issue}")
        if len(quality_issues) > 10:
            logger.info(f"  ... and {len(quality_issues) - 10} more")
        logger.info("="*60)
        
        ingestor.close()
        return True
    
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        ingestor.close()
        return False


if __name__ == "__main__":
    import sys
    
    csv_path = sys.argv[1] if len(sys.argv) > 1 else "company_records.csv"
    
    success = ingest_csv(
        csv_path=csv_path,
        mongo_uri=MONGO_URI,
        db_name=DB_NAME,
        collection_name=COLLECTION_NAME,
    )
    
    sys.exit(0 if success else 1)
