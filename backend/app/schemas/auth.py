from pydantic import BaseModel, ConfigDict, Field


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    is_guest: bool
    is_admin: bool


class AuthState(BaseModel):
    user: UserOut | None  # None = nobody signed in and guests are not allowed
    allow_registration: bool
    allow_guest: bool
    first_account: bool  # no account exists yet: the next one created administers the server


class Credentials(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=200)


class RegisterIn(Credentials):
    display_name: str | None = Field(None, max_length=64)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str = Field(max_length=200)
