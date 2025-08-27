import anthropic


# Call Anthropic API 
ANTHROPIC_API_KEY = 'Your API Key Here'
client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# Player data - will store club distances
player_data = {
    "clubs": {}
}

# Display the main menu options
def display_menu():
    
    print("\n AI Golf Caddy Assistant")
    print("1. Set up your club distances")
    print("2. Get club recommendation")
    print("3. Course strategy advice")
    print("4. Exit")
    
    
    choice = input("Enter your choice (1-4): ")
    return choice
# collect and store how far user hits each of their clubs
def setup_clubs():
    print("\n--- Club Distance Setup ---")
    print("Let's record how far you hit each club on average.")
    
    clubs = [
        "Driver", "3-Wood", "5-Wood", "3-Hybrid", "4-Hybrid", 
        "4-Iron", "5-Iron", "6-Iron", "7-Iron", "8-Iron", "9-Iron", 
        "Pitching Wedge", "Gap Wedge", "Sand Wedge", "Lob Wedge"
    ]
    
    for club in clubs:
        while True:
            try:
                distance = input(f"How far do you hit your {club} in yards? (press Enter to skip): ")
                if distance == "":
                    break
                distance = int(distance)
                player_data["clubs"][club] = distance
                break
            except ValueError:
                print("Please enter a valid number.")
    
    print("\nYour club distances have been saved!")
    print("Here's what we have:")
    for club, distance in player_data["clubs"].items():
        print(f"{club}: {distance} yards")


#Collect how far from the hole, the lie, and the wind conditon to then add it all into a prompt for claude to recommend a club

def get_club_recommendation():
    if not player_data["clubs"]:
        print("You need to set up your club distances first (Option 1).")
        return
    
    while True:
        try:
            distance = int(input("\nHow far are you from the hole (in yards)? "))
            break
        except ValueError:
            print("Please enter a valid number.")
    
    lie = input("What's your current lie? (fairway, rough, sand, etc.): ")
    wind = input("What are the wind conditions? (calm, light, strong headwind, strong tailwind, etc.): ")
    
    #Create the prompt for Claude to recommend a club

    prompt = f"""
    I need a club recommendation for my next golf shot. Here are my details:"""
    
    prompt += "My club distances:\n"
    for club in player_data["clubs"]:
        clubDistance = player_data["clubs"][club]
        prompt += f"{club}: {clubDistance} yards\n"

    #add onto the prompt so that claude knows how far from the hole you are, you're current lie, and any wind conditons 

    prompt += f"""Current situation:
    - Distance to hole: {distance} yards
    - Current lie: {lie}
    - Wind conditions: {wind}
    
    Please recommend the best club for this shot and explain your reasoning. 
    Also provide any tips for executing this shot successfully."""
    
    print("Asking your AI Caddy....")

    
    # Get response from Claude
    response = client.messages.create(
        model="claude-3-7-sonnet-20250219",
        max_tokens=1024,
        messages=[
            {"role": "user", "content": prompt}
        ]
    )
    
    #Print Claude's response to the prompt to the terminal

    print("\n--- Club Recommendation ---")
    print(response.content[0].text)

#Gather hole details to be given to claude to give advice on how to play a hole
def get_course_strategy():
    hole_par = input("\nWhat is the par for this hole? (3/4/5): ")
    hole_length = input("How long is the hole in yards? ")
    hazards = input("Are there any key hazards to consider? (water, bunkers, OB, etc.): ")
    hole_shape = input("What's the shape of the hole? (straight, dogleg left, dogleg right): ")
    
#Make a new prompt for Claude to get advice on how to play a hole based on the conditions and criteria of the hole

    prompt = f"""
    I need advice on how to play this golf hole strategically:
    
    Hole details:
    - Par: {hole_par}
    - Length: {hole_length} yards
    - Shape: {hole_shape}
    - Hazards: {hazards}
    
    My club distances:"""
    for club in player_data["clubs"]:
        Distance = player_data["clubs"][club]
        prompt += f"{club}: {Distance} yards\n"

    #Add on last piece of the prompt so that claude knows what we need to know for a club recommendation
    
    prompt += """Please provide a hole strategy that covers:
    1. What club(s) to use off the tee
    2. Where to aim for each shot
    3. How to handle the approach to the green
    4. What risks to avoid
    5. Any specific shot shapes that would be beneficial
    """
    
    print("\nAnalyzing hole strategy...")
    
    # Get response from Claude
    response = client.messages.create(
        model="claude-3-7-sonnet-20250219",
        max_tokens=1024,
        messages=[
            {"role": "user", "content": prompt}
        ]
    )
    
    #Print Claudes response to the prompt to the terminal 

    print("\n--- Course Strategy ---")
    print(response.content[0].text)

#main funtion that calls all other fucntions into a menu for the main interface of the program

def main():
    print("Welcome to your AI Golf Caddy Assistant!")
    blnStop = False
    while blnStop is False:
        choice = display_menu()
        
        if choice == '1':
            setup_clubs()
        elif choice == '2':
            get_club_recommendation()
        elif choice == '3':
            get_course_strategy()
        elif choice == '4':
            print("Thank you for using the AI Golf Caddy Assistant. Good luck on the course!")
            blnStop = True
        else:
            print("Invalid choice. Please try again.")

#This variable __name__ is defined by python when you start the program to equal "main". This satisfies the if statment running the main.

if __name__ == "__main__":
    main()