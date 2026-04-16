Feature: File Menu

    Scenario: A file opened shows up in recent files
        Given No files have been loaded
        When File A is loaded
        And File B is loaded
        Then File A and File B appear in recent files list 

    Scenario: Recent Files can be cleared
        Given File A and B are in recent files list
        When Recent files clear action is called
        Then Recent files is empty

    Scenario: Recent Files keeps up to 10 entries
        Given File 1, 2, 3 to 10 are loaded in order
        When File 11 is loaded
        Then Recent files contains files 2-11

    Scenario: Recent Files lists files one
        Given File 1, 2, 3 to 10 are loaded in order
        When File 3 is loaded
        Then Recent files contains files in order 3, 1, 2, 4-10
