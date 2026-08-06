"""
WSGI configuration for PythonAnywhere
This file connects the web server to your WSGI application
"""

import sys
import os

# Add the project root to the path
project_path = '/home/oliwiercwel/finance-platform'
if project_path not in sys.path:
    sys.path.insert(0, project_path)

# Import the WSGI application
from server_wsgi import application
