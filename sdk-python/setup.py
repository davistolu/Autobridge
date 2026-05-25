from setuptools import setup, find_packages

setup(
    name="autobridge-sdk",
    version="0.1.0",
    description="AutoBridge Python SDK — connect any Python backend to the AutoBridge framework",
    packages=find_packages(),
    python_requires=">=3.9",
    install_requires=["requests>=2.28.0"],
    extras_require={
        "flask": ["Flask>=2.0"],
        "fastapi": ["fastapi>=0.100.0"],
    },
)
