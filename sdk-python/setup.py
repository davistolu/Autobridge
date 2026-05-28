from setuptools import setup, find_packages

setup(
    name="wirebridge-sdk",
    version="0.1.0",
    description="WireBridge Python SDK — connect any Python backend to the WireBridge framework",
    packages=find_packages(),
    python_requires=">=3.9",
    install_requires=["requests>=2.28.0"],
    extras_require={
        "flask": ["Flask>=2.0"],
        "fastapi": ["fastapi>=0.100.0"],
    },
)
